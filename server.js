const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.ico':'image/x-icon', '.svg':'image/svg+xml' };

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/status') {
    return send(res, 200, { ok:true, lisConfigured:Boolean(process.env.LIS_API_URL && process.env.LIS_API_KEY), lisEndpointConfigured:Boolean(process.env.LIS_API_URL), message: process.env.LIS_API_URL && process.env.LIS_API_KEY ? 'LIS API настроен на сервере' : 'Добавьте LIS_API_URL и LIS_API_KEY в переменные окружения хостинга' });
  }
  if (url.pathname === '/api/lis-skins') {
    const endpoint = process.env.LIS_API_URL;
    const key = process.env.LIS_API_KEY;
    if (!endpoint || !key) return send(res, 503, { error:'LIS API не настроен. Добавьте LIS_API_URL и LIS_API_KEY в настройки хостинга.' });
    try {
      const target = new URL(endpoint);
      // Pass through common filters. The exact parameter names depend on the API plan/documentation.
      for (const name of ['min','max','search']) if (url.searchParams.has(name)) target.searchParams.set(name, url.searchParams.get(name));
      const headerName = process.env.LIS_API_KEY_HEADER || 'X-API-KEY';
      const upstream = await fetch(target, { headers: { [headerName]: key, 'Accept':'application/json' }, signal: AbortSignal.timeout(20000) });
      const bodyText = await upstream.text();
      let body; try { body = JSON.parse(bodyText); } catch { body = { raw: bodyText.slice(0, 3000) }; }
      if (!upstream.ok) return send(res, upstream.status, { error:`LIS API вернул HTTP ${upstream.status}`, details:body });
      return send(res, 200, { data:body });
    } catch (e) {
      return send(res, 502, { error:'Не удалось получить ответ от LIS API', details:e.name === 'TimeoutError' ? 'Превышено время ожидания (20 секунд)' : e.message });
    }
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) return send(res, 403, { error:'Forbidden' });
  fs.readFile(file, (err, content) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, content, MIME[path.extname(file)] || 'application/octet-stream');
  });
});
server.listen(PORT, '0.0.0.0', () => console.log(`CS2 Skin Monitor listening on ${PORT}`));
