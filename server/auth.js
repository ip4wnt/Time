'use strict';
// Авторизация: логин + пароль. Пароль хранится только как scrypt-хэш,
// сессии — как SHA-256 от токена.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const config = require('./config');
const { HttpError } = require('./http');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function normalizeLogin(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT_OPTS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32, SCRYPT_OPTS);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
}

function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 6) throw new HttpError(400, 'Пароль короче шести знаков');
  if (p.length > 200) throw new HttpError(400, 'Слишком длинный пароль');
  return p;
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ---- сессии ----
async function createSession(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await db.query(
    'INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
    [sha256(token), userId, expires, req.ip, String(req.headers['user-agent'] || '').slice(0, 300)],
  );
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [userId]);
  return { token, expires };
}

async function getSessionUser(token) {
  if (!token) return null;
  const r = await db.query(
    `SELECT u.id, u.login, u.created_at, u.settings, s.token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  // обновляем last_seen не чаще чем раз в несколько минут — дешёвый UPDATE
  db.query('UPDATE sessions SET last_seen = now() WHERE token_hash = $1 AND last_seen < now() - interval \'5 minutes\'', [row.token_hash]).catch(() => {});
  return { id: row.id, login: row.login, created_at: row.created_at, settings: row.settings };
}

async function destroySession(token) {
  if (!token) return;
  await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

// ---- защита от перебора ----
async function checkRateLimit(ip) {
  const r = await db.query(
    'SELECT count(*)::int AS n FROM login_attempts WHERE ip = $1 AND ok = false AND created_at > now() - ($2::int * interval \'1 millisecond\')',
    [ip, config.authRateLimit.windowMs],
  );
  if (r.rows[0].n >= config.authRateLimit.max) {
    throw new HttpError(429, 'Слишком много попыток. Попробуйте позже.');
  }
}

async function logAttempt(login, ip, ok) {
  await db.query('INSERT INTO login_attempts(login_norm, ip, ok) VALUES ($1,$2,$3)', [login, ip, ok]);
}

// ---- вход ----
// Классический вход: логин + пароль. Про незнакомый логин не сообщаем отдельно.
async function login(loginRaw, password, req) {
  await checkRateLimit(req.ip);
  const norm = normalizeLogin(loginRaw);
  if (!norm || norm.length > 64) throw new HttpError(400, 'Введите логин');
  const u = await db.query('SELECT id, login, password_hash, delete_requested_at FROM users WHERE login_norm = $1', [norm]);
  if (!u.rowCount) {
    await logAttempt(norm, req.ip, false);
    throw new HttpError(401, 'Неверный логин или пароль');
  }
  const row = u.rows[0];
  if (!row.password_hash) throw new HttpError(409, 'У этого логина пароль ещё не задан');
  const ok = verifyPassword(password, row.password_hash);
  await logAttempt(norm, req.ip, ok);
  if (!ok) throw new HttpError(401, 'Неверный логин или пароль');
  // Вход в течение 30 дней отменяет запрос на удаление аккаунта
  let restored = false;
  if (row.delete_requested_at) {
    await db.query('UPDATE users SET delete_requested_at = NULL WHERE id = $1', [row.id]);
    restored = true;
  }
  const s = await createSession(row.id, req);
  return { status: 'ok', restored, ...s };
}

// ---- удаление аккаунта ----
// Помечаем аккаунт и выходим со всех устройств. Через DELETE_AFTER_DAYS данные удаляются.
const DELETE_AFTER_DAYS = 30;

async function requestDeletion(userId) {
  await db.query('UPDATE users SET delete_requested_at = now() WHERE id = $1', [userId]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  return { days: DELETE_AFTER_DAYS };
}

// Окончательное удаление просроченных аккаунтов (вызывается по таймеру в server/index.js)
async function purgeDeletedUsers() {
  const gone = await db.query(
    `SELECT id FROM users WHERE delete_requested_at IS NOT NULL
       AND delete_requested_at < now() - ($1::int * interval '1 day')`, [DELETE_AFTER_DAYS]);
  for (const u of gone.rows) {
    // служебная транзакция: политики RLS пропускают её, пользовательского контекста здесь нет
    const files = await db.txAdmin(async (c) => {
      const f = await c.query('SELECT storage_key FROM files WHERE user_id = $1', [u.id]);
      await c.query('DELETE FROM users WHERE id = $1', [u.id]);   // остальное уходит по ON DELETE CASCADE
      return f;
    });
    for (const f of files.rows) {
      await fs.promises.unlink(path.join(config.uploadDir, f.storage_key)).catch(() => {});
    }
    console.log(`[cleanup] аккаунт id=${u.id} удалён окончательно`);
  }
  return gone.rowCount;
}

// Регистрация: логин + пароль
async function createUser(loginRaw, password) {
  const norm = normalizeLogin(loginRaw);
  if (!norm || norm.length > 64) throw new HttpError(400, 'Введите логин');
  validatePassword(password);
  const exists = await db.query('SELECT 1 FROM users WHERE login_norm = $1', [norm]);
  if (exists.rowCount) throw new HttpError(409, 'Этот логин уже занят');
  // служебная транзакция: пользователя ещё нет, поэтому заготовки создаём в обход RLS
  return db.txAdmin(async (c) => {
    const u = await c.query('INSERT INTO users(login, login_norm, password_hash) VALUES ($1,$2,$3) RETURNING id',
      [String(loginRaw).trim(), norm, hashPassword(password)]);
    const id = u.rows[0].id;
    await seedDefaults(c, id);
    return id;
  });
}

async function register(loginRaw, password, req) {
  await checkRateLimit(req.ip);
  const userId = await createUser(loginRaw, password);
  await logAttempt(normalizeLogin(loginRaw), req.ip, true);
  const s = await createSession(userId, req);
  return { status: 'ok', ...s };
}

// Смена пароля в разделе «профиль»
async function changePassword(userId, current, next) {
  const u = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!u.rowCount) throw new HttpError(404, 'Пользователь не найден');
  const stored = u.rows[0].password_hash;
  if (stored && !verifyPassword(current, stored)) throw new HttpError(401, 'Текущий пароль неверный');
  validatePassword(next);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(next), userId]);
}

async function setPassword(loginRaw, password) {
  validatePassword(password);
  const norm = normalizeLogin(loginRaw);
  const r = await db.query('UPDATE users SET password_hash = $1 WHERE login_norm = $2 RETURNING id', [hashPassword(password), norm]);
  if (!r.rowCount) throw new HttpError(404, 'Пользователь не найден');
  return r.rows[0].id;
}

const DEFAULT_ACTIVITIES = [
  { name: 'сон', color: '#262626', is_sleep: true },
  { name: 'мысли', color: '#4A4A4A' },
  { name: 'рутина', color: '#AA952E' },
  { name: 'работа', color: '#73D383' },
  { name: 'развлечения', color: '#FF81BC' },
  { name: 'семья', color: '#51006C' },
  { name: 'спорт', color: '#B71506' },
  { name: 'учеба', color: '#476FAF' },
  { name: 'медицина', color: '#0B7204' },
];

async function seedDefaults(c, userId) {
  let pos = 0;
  for (const a of DEFAULT_ACTIVITIES) {
    await c.query('INSERT INTO activities(user_id, name, color, position, is_sleep) VALUES ($1,$2,$3,$4,$5)', [userId, a.name, a.color, pos++, !!a.is_sleep]);
  }
}

module.exports = {
  createUser, setPassword, changePassword,
  normalizeLogin, hashPassword, verifyPassword, createSession, getSessionUser, destroySession,
  login, register, seedDefaults, DEFAULT_ACTIVITIES,
  requestDeletion, purgeDeletedUsers, DELETE_AFTER_DAYS,
};
