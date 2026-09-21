'use strict';
// Конфигурация из переменных окружения (см. deploy/.env.example)
const path = require('node:path');
const fs = require('node:fs');

// Простейшая загрузка .env без библиотек
const envPath = process.env.CHRONUM_ENV || path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const root = path.join(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || 'postgres://chronum:chronum@127.0.0.1:5432/chronum',
  uploadDir: path.resolve(process.env.UPLOAD_DIR || path.join(root, 'data', 'uploads')),
  publicDir: path.join(root, 'public'),
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  secureCookies: process.env.SECURE_COOKIES !== '0',       // на VPS за HTTPS — включено
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,
  maxJsonBytes: 2 * 1024 * 1024,
  trustProxy: process.env.TRUST_PROXY === '1',              // брать IP из X-Forwarded-For (nginx)
  authRateLimit: { windowMs: 15 * 60 * 1000, max: 20 },      // попыток входа с одного IP
};
