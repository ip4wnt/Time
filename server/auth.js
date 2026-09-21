'use strict';
// Авторизация без пароля: имя + два контрольных вопроса, придуманных пользователем.
// Ответы хранятся только как scrypt-хэши, сессии — как SHA-256 от токена.
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');
const { HttpError } = require('./http');

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };

function normalizeLogin(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Ответ сравнивается без учёта регистра, лишних пробелов и знаков препинания по краям
function normalizeAnswer(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/g, '').replace(/ё/g, 'е');
}

function hashAnswer(answer) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizeAnswer(answer), salt, 32, SCRYPT_OPTS);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyAnswer(answer, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const hash = crypto.scryptSync(normalizeAnswer(answer), Buffer.from(saltHex, 'hex'), 32, SCRYPT_OPTS);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
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

// ---- challenge: имя введено, ждём ответы на вопросы ----
const challenges = new Map(); // id -> { userId, questionIds, ip, expires }
const CHALLENGE_TTL = 5 * 60 * 1000;

function cleanupChallenges() {
  const now = Date.now();
  for (const [k, v] of challenges) if (v.expires < now) challenges.delete(k);
}
setInterval(cleanupChallenges, 60 * 1000).unref();

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Шаг 1: имя. Известный пользователь -> вопросы в случайном порядке. Неизвестный -> регистрация.
async function start(login, ip) {
  await checkRateLimit(ip);
  const norm = normalizeLogin(login);
  if (!norm || norm.length > 64) throw new HttpError(400, 'Введите имя');
  const u = await db.query('SELECT id, login FROM users WHERE login_norm = $1', [norm]);
  if (!u.rowCount) return { status: 'new', login: String(login).trim() };
  const userId = u.rows[0].id;
  const qs = await db.query('SELECT id, question FROM security_questions WHERE user_id = $1 ORDER BY position, id', [userId]);
  const picked = shuffle(qs.rows).slice(0, 2);
  const id = crypto.randomBytes(18).toString('base64url');
  challenges.set(id, { userId, questionIds: picked.map((q) => q.id), ip, expires: Date.now() + CHALLENGE_TTL });
  return { status: 'known', login: u.rows[0].login, challenge: id, questions: picked.map((q) => ({ id: q.id, question: q.question })) };
}

// Шаг 2: ответы
async function answer(challengeId, answers, req) {
  await checkRateLimit(req.ip);
  const ch = challenges.get(challengeId);
  if (!ch || ch.expires < Date.now()) throw new HttpError(400, 'Сессия входа устарела, начните заново');
  const qs = await db.query('SELECT id, answer_hash FROM security_questions WHERE user_id = $1 AND id = ANY($2::bigint[])', [ch.userId, ch.questionIds]);
  const u = await db.query('SELECT login_norm FROM users WHERE id = $1', [ch.userId]);
  let ok = qs.rowCount === ch.questionIds.length && qs.rowCount > 0;
  for (const q of qs.rows) {
    const a = answers && answers[String(q.id)];
    if (!a || !verifyAnswer(a, q.answer_hash)) ok = false;
  }
  await logAttempt(u.rows[0]?.login_norm || null, req.ip, ok);
  if (!ok) throw new HttpError(401, 'Ответы не совпали');
  challenges.delete(challengeId);
  return createSession(ch.userId, req);
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || questions.length !== 2) throw new HttpError(400, 'Нужно ровно два вопроса');
  for (const q of questions) {
    if (!q || !String(q.question || '').trim() || !String(q.answer || '').trim()) throw new HttpError(400, 'Заполните вопросы и ответы');
    if (String(q.question).length > 300 || String(q.answer).length > 200) throw new HttpError(400, 'Слишком длинный текст');
  }
}

// Регистрация: имя + 2 вопроса с ответами
async function createUser(login, questions) {
  const norm = normalizeLogin(login);
  if (!norm || norm.length > 64) throw new HttpError(400, 'Введите имя');
  validateQuestions(questions);
  const exists = await db.query('SELECT 1 FROM users WHERE login_norm = $1', [norm]);
  if (exists.rowCount) throw new HttpError(409, 'Это имя уже занято');
  return db.tx(async (c) => {
    const u = await c.query('INSERT INTO users(login, login_norm) VALUES ($1,$2) RETURNING id', [String(login).trim(), norm]);
    const id = u.rows[0].id;
    let pos = 0;
    for (const q of questions) {
      await c.query('INSERT INTO security_questions(user_id, position, question, answer_hash) VALUES ($1,$2,$3,$4)', [id, pos++, String(q.question).trim(), hashAnswer(q.answer)]);
    }
    await seedDefaults(c, id);
    return id;
  });
}

async function register(login, questions, req) {
  await checkRateLimit(req.ip);
  const userId = await createUser(login, questions);
  await logAttempt(normalizeLogin(login), req.ip, true);
  return createSession(userId, req);
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

// Смена вопросов в разделе «я»: questions = [{id?, question, answer?}] — без answer хэш не меняется
async function updateQuestions(userId, questions) {
  if (!Array.isArray(questions) || questions.length < 2) throw new HttpError(400, 'Нужно минимум два вопроса');
  await db.tx(async (c) => {
    const keep = [];
    let pos = 0;
    for (const q of questions) {
      const text = String(q.question || '').trim();
      if (!text) throw new HttpError(400, 'Пустой вопрос');
      if (q.id) {
        const r = await c.query('SELECT id FROM security_questions WHERE id = $1 AND user_id = $2', [q.id, userId]);
        if (!r.rowCount) throw new HttpError(404, 'Вопрос не найден');
        if (q.answer && String(q.answer).trim()) {
          await c.query('UPDATE security_questions SET question=$1, answer_hash=$2, position=$3 WHERE id=$4', [text, hashAnswer(q.answer), pos, q.id]);
        } else {
          await c.query('UPDATE security_questions SET question=$1, position=$2 WHERE id=$3', [text, pos, q.id]);
        }
        keep.push(q.id);
      } else {
        if (!q.answer || !String(q.answer).trim()) throw new HttpError(400, 'Для нового вопроса нужен ответ');
        const r = await c.query('INSERT INTO security_questions(user_id, position, question, answer_hash) VALUES ($1,$2,$3,$4) RETURNING id', [userId, pos, text, hashAnswer(q.answer)]);
        keep.push(r.rows[0].id);
      }
      pos++;
    }
    await c.query('DELETE FROM security_questions WHERE user_id = $1 AND NOT (id = ANY($2::bigint[]))', [userId, keep]);
  });
}

module.exports = {
  createUser,
  normalizeLogin, hashAnswer, verifyAnswer, createSession, getSessionUser, destroySession,
  start, answer, register, updateQuestions, seedDefaults, DEFAULT_ACTIVITIES,
};
