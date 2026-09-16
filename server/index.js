'use strict';
// ХРОНУМ — точка входа сервера. Node.js 20+, единственная зависимость — pg.
const http = require('node:http');
const fs = require('node:fs');
const { URL } = require('node:url');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const { router, COOKIE } = require('./routes');
const { HttpError, sendJson, readJson, parseCookies, clientIp, serveStatic } = require('./http');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=()',
};

function sessionTokenFrom(req) {
  const cookies = parseCookies(req);
  if (cookies[COOKIE]) return cookies[COOKIE];
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

async function handleApi(req, res, url) {
  const match = router.match(req.method, url.pathname);
  if (!match) throw new HttpError(404, 'Нет такого метода API');
  req.ip = clientIp(req);
  req.sessionToken = sessionTokenFrom(req);
  let user = null;
  if (!match.opts.public) {
    user = await auth.getSessionUser(req.sessionToken);
    if (!user) throw new HttpError(401, 'Нужно войти');
  }
  const query = Object.fromEntries(url.searchParams.entries());
  const isJson = (req.headers['content-type'] || '').includes('application/json');
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) && isJson ? await readJson(req) : {};
  const result = await match.handler({ req, res, user, params: match.params, query, body });
  if (result !== undefined && !res.headersSent) sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url.pathname === '/' ? '/index.html' : url.pathname);
    } else {
      sendJson(res, 405, { error: 'Метод не поддерживается' });
    }
  } catch (e) {
    if (e instanceof HttpError) {
      sendJson(res, e.status, { error: e.message, ...(e.extra || {}) });
    } else {
      console.error(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`, e);
      // 5xx через внешние прокси иногда заменяются, поэтому отдаём понятный JSON
      sendJson(res, 500, { error: 'Внутренняя ошибка сервера' });
    }
  } finally {
    if (process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

async function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  await db.migrate();
  // чистим просроченные сессии и старые попытки входа раз в час
  const cleanup = () => {
    db.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {});
    db.query("DELETE FROM login_attempts WHERE created_at < now() - interval '30 days'").catch(() => {});
    db.query("DELETE FROM note_revisions WHERE created_at < now() - interval '1 hour'").catch(() => {});
  };
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000).unref();
  server.listen(config.port, config.host, () => {
    console.log(`ХРОНУМ запущен: http://${config.host}:${config.port}  (загрузки: ${config.uploadDir})`);
  });
}

main().catch((e) => { console.error('Не удалось запустить сервер:', e); process.exit(1); });

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); });
