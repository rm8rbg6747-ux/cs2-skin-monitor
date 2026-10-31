
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

const COOKIE_NAME = 'cs2_session';
const SESSION_DAYS = 30;
const CACHE_TTL = 5 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const cache = new Map();
const loginAttempts = new Map();

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  if (Buffer.isBuffer(data)) return res.end(data);
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function safeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function sign(value) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

function createSession() {
  const payload = Buffer.from(JSON.stringify({
    user: process.env.SITE_USERNAME,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  })).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function validSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(part => {
      const index = part.indexOf('=');
      if (index === -1) return ['', ''];
      return [
        part.slice(0, index).trim(),
        part.slice(index + 1).trim()
      ];
    })
  );

  const token = cookies[COOKIE_NAME];
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;

  if (!safeCompare(signature, sign(payload))) return false;

  try {
    const data = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );

    return data.user === process.env.SITE_USERNAME &&
      data.exp > Date.now();
  } catch {
    return false;
  }
}

async function getCached(key, fetchData) {
  const saved = cache.get(key);

  if (saved && saved.expiresAt > Date.now()) {
    return saved.data;
  }

  if (saved?.promise) {
    return saved.promise;
  }

  const promise = fetchData();

  cache.set(key, { promise, expiresAt: 0 });

  try {
    const data = await promise;
    cache.set(key, {
      data,
      expiresAt: Date.now() + CACHE_TTL
    });
    return data;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

const loginPage = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#10131b">
<title>Вход — CS2 Skin Monitor</title>
<style>
*{box-sizing:border-box}
body{
  margin:0;min-height:100vh;display:flex;align-items:center;
  justify-content:center;padding:20px;background:#10131b;
  color:#fff;font-family:Arial,sans-serif
}
.card{
  width:100%;max-width:380px;padding:30px;
  background:#1b202c;border:1px solid #30394a;
  border-radius:18px
}
h1{font-size:25px;margin:0 0 8px}
p{color:#9ba6b8;margin:0 0 25px}
label{display:block;margin:15px 0 7px;color:#cbd3df}
input{
  width:100%;padding:14px;border-radius:9px;
  border:1px solid #3a4558;background:#111722;
  color:white;font-size:16px
}
button{
  width:100%;padding:14px;margin-top:22px;
  border:0;border-radius:9px;background:#5478ef;
  color:white;font-size:16px;font-weight:bold
}
#error{color:#ff7777;margin-top:15px;min-height:20px}
</style>
</head>
<body>
<div class="card">
<h1>CS2 Skin Monitor</h1>
<p>Войди, чтобы открыть свой монитор</p>
<form id="loginForm">
<label for="username">Логин</label>
<input id="username" autocomplete="username" required>
<label for="password">Пароль</label>
<input id="password" type="password"
autocomplete="current-password" required>
<button type="submit">Войти</button>
<div id="error"></div>
</form>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const error = document.getElementById('error');
  error.textContent = 'Проверка...';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      error.textContent = data.error || 'Неверный логин или пароль';
      return;
    }

    location.replace('/');
  } catch {
    error.textContent = 'Ошибка соединения. Попробуй ещё раз.';
  }
});
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (!process.env.SITE_USERNAME ||
      !process.env.SITE_PASSWORD ||
      !process.env.SESSION_SECRET) {
    return send(res, 503, {
      error: 'Настрой SITE_USERNAME, SITE_PASSWORD и SESSION_SECRET в Render.'
    });
  }

  // Страница входа доступна без авторизации.
  if (url.pathname === '/login') {
    return send(res, 200, loginPage, 'text/html; charset=utf-8');
  }

  // Обработка входа.
  if (url.pathname === '/api/login' && req.method === 'POST') {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.socket.remoteAddress;
    const now = Date.now();
    const attempt = loginAttempts.get(ip);

    if (attempt && now < attempt.until && attempt.count >= 10) {
      return send(res, 429, {
        error: 'Слишком много попыток. Подожди 15 минут.'
      });
    }

    let raw = '';

    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 10000) {
          return send(res, 413, { error: 'Слишком большой запрос' });
        }
      }

      const credentials = JSON.parse(raw);
      const username = String(credentials.username || '');
      const password = String(credentials.password || '');

      const correct =
        safeCompare(username, process.env.SITE_USERNAME) &&
        safeCompare(password, process.env.SITE_PASSWORD);

      if (!correct) {
        const current = attempt && now < attempt.until
          ? attempt
          : { count: 0, until: now + 15 * 60 * 1000 };

        current.count++;
        loginAttempts.set(ip, current);

        return send(res, 401, {
          error: 'Неверный логин или пароль'
        });
      }

      loginAttempts.delete(ip);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Set-Cookie':
          `${COOKIE_NAME}=${createSession()}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`
      });

      return res.end(JSON.stringify({ ok: true }));
    } catch {
      return send(res, 400, { error: 'Некорректный запрос' });
    }
  }

  // Выход из аккаунта.
  if (url.pathname === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie':
        `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
    });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Защита всех остальных страниц и API.
  if (!validSession(req)) {
    if (url.pathname.startsWith('/api/')) {
      return send(res, 401, { error: 'Требуется авторизация' });
    }

    res.writeHead(302, {
      Location: '/login',
      'Cache-Control': 'no-store'
    });
    return res.end();
  }

  if (url.pathname === '/api/status') {
    return send(res, 200, {
      ok: true,
      lisConfigured: Boolean(process.env.LIS_API_URL && process.env.LIS_API_KEY),
      lisEndpointConfigured: Boolean(process.env.LIS_API_URL),
      message: process.env.LIS_API_URL && process.env.LIS_API_KEY
        ? 'LIS API настроен на сервере'
        : 'Добавьте LIS_API_URL и LIS_API_KEY в переменные окружения хостинга'
    });
  }

  if (
    url.pathname === '/api/csmarket-prices' ||
    url.pathname === '/api/csmarket-orders'
  ) {
    const isOrders = url.pathname === '/api/csmarket-orders';

    const endpoint = isOrders
      ? 'https://market.csgo.com/api/v2/prices/orders/RUB.json'
      : 'https://market.csgo.com/api/v2/prices/RUB.json';

    try {
      const body = await getCached(endpoint, async () => {
        const upstream = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(30000)
        });

        if (!upstream.ok) {
          throw new Error(`Market.CSGO вернул HTTP ${upstream.status}`);
        }

        const data = await upstream.json();

        if (data.success === false) {
          throw new Error('Market.CSGO не подтвердил успешный ответ');
        }

        return data;
      });

      return send(res, 200, { data: body });
    } catch (e) {
      return send(res, 502, {
        error: 'Не удалось получить данные Market.CSGO',
        details: e.message
      });
    }
  }

  if (url.pathname === '/api/lis-skins') {
    const endpoint = process.env.LIS_API_URL;
    const key = process.env.LIS_API_KEY;

    if (!endpoint || !key) {
      return send(res, 503, {
        error: 'LIS API не настроен. Проверь настройки Render.'
      });
    }

    try {
      const target = new URL(endpoint);

      for (const name of ['min', 'max', 'search']) {
        if (url.searchParams.has(name)) {
          target.searchParams.set(name, url.searchParams.get(name));
        }
      }

      const headerName = process.env.LIS_API_KEY_HEADER || 'X-API-KEY';

      const body = await getCached(target.toString(), async () => {
        const upstream = await fetch(target, {
          headers: {
            [headerName]: key,
            Accept: 'application/json'
          },
          signal: AbortSignal.timeout(20000)
        });

        const bodyText = await upstream.text();

        let data;
        try {
          data = JSON.parse(bodyText);
        } catch {
          data = { raw: bodyText.slice(0, 3000) };
        }

        if (!upstream.ok) {
          throw new Error(`LIS API вернул HTTP ${upstream.status}`);
        }

        return data;
      });

      return send(res, 200, { data: body });
    } catch (e) {
      return send(res, 502, {
        error: 'Не удалось получить ответ от LIS API',
        details: e.name === 'TimeoutError'
          ? 'Превышено время ожидания (20 секунд)'
          : e.message
      });
    }
  }

  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, 'Bad Request', 'text/plain; charset=utf-8');
  }

  if (pathname === '/') pathname = '/index.html';

  const file = path.resolve(ROOT, `.${pathname}`);
  const relative = path.relative(ROOT, file);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }

  fs.readFile(file, (err, content) => {
    if (err) {
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }

    const type = MIME[path.extname(file).toLowerCase()]
      || 'application/octet-stream';

    return send(res, 200, content, type);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CS2 Skin Monitor listening on ${PORT}`);
});
