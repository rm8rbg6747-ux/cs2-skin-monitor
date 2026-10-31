const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

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

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  if (Buffer.isBuffer(data)) {
    return res.end(data);
  }

  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

function safeCompare(a, b) {
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function authorized(req) {
  const username = process.env.SITE_USERNAME;
  const password = process.env.SITE_PASSWORD;

  if (!username || !password) {
    return false;
  }

  const header = req.headers.authorization || '';

  if (!header.startsWith('Basic ')) {
    return false;
  }

  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');

    if (separator === -1) return false;

    const suppliedUsername = decoded.slice(0, separator);
    const suppliedPassword = decoded.slice(separator + 1);

    return safeCompare(suppliedUsername, username) &&
      safeCompare(suppliedPassword, password);
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  // Если логин или пароль не настроены, сайт остаётся закрытым.
  if (!process.env.SITE_USERNAME || !process.env.SITE_PASSWORD) {
    return send(res, 503, {
      error: 'Авторизация не настроена. Добавьте SITE_USERNAME и SITE_PASSWORD в Render.'
    });
  }

  // Защищаем все страницы и API.
  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="CS2 Skin Monitor", charset="UTF-8"',
      'Cache-Control': 'no-store'
    });
    res.writeHead(401, {
  'WWW-Authenticate': 'Basic realm="CS2 Skin Monitor", charset="UTF-8"',
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store'
});
return res.end('Требуется авторизация');
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

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
      const upstream = await fetch(endpoint, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(30000)
      });

      if (!upstream.ok) {
        return send(res, upstream.status, {
          error: `Market.CSGO вернул HTTP ${upstream.status}`
        });
      }

      const body = await upstream.json();

      if (body.success === false) {
        return send(res, 502, {
          error: 'Market.CSGO не подтвердил успешный ответ',
          details: body
        });
      }

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
        error: 'LIS API не настроен. Добавьте LIS_API_URL и LIS_API_KEY в настройки хостинга.'
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

      const upstream = await fetch(target, {
        headers: {
          [headerName]: key,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(20000)
      });

      const bodyText = await upstream.text();

      let body;
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = { raw: bodyText.slice(0, 3000) };
      }

      if (!upstream.ok) {
        return send(res, upstream.status, {
          error: `LIS API вернул HTTP ${upstream.status}`,
          details: body
        });
      }

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

  if (pathname === '/') {
    pathname = '/index.html';
  }

  const file = path.resolve(ROOT, `.${pathname}`);
  const relative = path.relative(ROOT, file);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  }

  fs.readFile(file, (err, content) => {
    if (err) {
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }

    const type = MIME[path.extname(file).toLowerCase()] ||
      'application/octet-stream';

    return send(res, 200, content, type);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CS2 Skin Monitor listening on ${PORT}`);
});
