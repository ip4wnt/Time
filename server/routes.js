'use strict';
// REST API. Все обработчики получают ctx = { req, res, user, params, query, body }.
// Каждый запрос к данным фильтруется по user_id — данные пользователей строго изолированы.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('./db');
// Обработчик уже выполняется внутри транзакции пользователя (db.withUser),
// поэтому «вложенная» транзакция не нужна — оставляем прежнюю форму вызова.
const tx = (q, fn) => fn(q);
const auth = require('./auth');
const food = require('./food');
const config = require('./config');
const { HttpError, Router, sendJson, readBody, cookieHeader } = require('./http');

const router = new Router();
const COOKIE = 'chronum_session';

function need(v, msg) { if (v === undefined || v === null || v === '') throw new HttpError(400, msg); return v; }
function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isColor(s) { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s); }
function int(v, msg) { const n = Number(v); if (!Number.isInteger(n)) throw new HttpError(400, msg || 'Ожидалось число'); return n; }
function str(v, max = 20000) { return String(v ?? '').slice(0, max); }
function dateStr(d) { return d instanceof Date ? d.toISOString().slice(0, 10) : d; }

function sessionCookie(token, expires) {
  return cookieHeader(COOKIE, token, { maxAge: Math.floor((expires - Date.now()) / 1000), secure: config.secureCookies });
}
function clearCookie() { return cookieHeader(COOKIE, '', { maxAge: 0, secure: config.secureCookies }); }

// ---------------- auth ----------------
router.add('POST', '/api/auth/login', async ({ q, body, req, res }) => {
  const r = await auth.login(body.login, body.password, req);
  res.setHeader('Set-Cookie', sessionCookie(r.token, r.expires));
  return { ok: true, status: 'ok', token: r.token };
}, { public: true });
router.add('POST', '/api/auth/register', async ({ q, body, req, res }) => {
  const r = await auth.register(body.login, body.password, req);
  res.setHeader('Set-Cookie', sessionCookie(r.token, r.expires));
  return { ok: true, status: 'ok', token: r.token };
}, { public: true });
router.add('POST', '/api/auth/logout', async ({ q, req, res }) => {
  await auth.destroySession(req.sessionToken);
  res.setHeader('Set-Cookie', clearCookie());
  return { ok: true };
}, { public: true });

router.add('GET', '/api/me', async ({ q, user }) => {
  const s = await q.query('SELECT created_at, last_seen, ip, user_agent FROM sessions WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 10', [user.id]);
  const a = await q.query('SELECT ip, ok, created_at FROM login_attempts WHERE login_norm=$1 ORDER BY created_at DESC LIMIT 10', [auth.normalizeLogin(user.login)]);
  return { user: { id: user.id, login: user.login, created_at: user.created_at, settings: user.settings }, sessions: s.rows, attempts: a.rows };
});
router.add('PUT', '/api/me/password', async ({ q, user, body }) => { await auth.changePassword(user.id, body.current, body.next); return { ok: true }; });
router.add('PUT', '/api/me/settings', async ({ q, user, body }) => {
  const settings = body.settings && typeof body.settings === 'object' ? body.settings : {};
  await q.query('UPDATE users SET settings = settings || $2::jsonb WHERE id=$1', [user.id, JSON.stringify(settings)]);
  return { ok: true };
});
router.add('POST', '/api/me/delete', async ({ q, user, res }) => {
  const r = await auth.requestDeletion(user.id);
  res.setHeader('Set-Cookie', clearCookie());
  return { ok: true, days: r.days };
});
router.add('POST', '/api/me/logout-all', async ({ q, user, res }) => {
  await q.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
  res.setHeader('Set-Cookie', clearCookie());
  return { ok: true };
});

// ---------------- bootstrap: справочники ----------------
router.add('GET', '/api/bootstrap', async ({ q, user }) => {
  const [acts, tags, counters] = await Promise.all([
    q.query('SELECT id, name, color, position, is_sleep, archived FROM activities WHERE user_id=$1 ORDER BY position, id', [user.id]),
    q.query('SELECT id, activity_id, name, position FROM tags WHERE user_id=$1 ORDER BY position, id', [user.id]),
    q.query('SELECT id, name, unit, position FROM counters WHERE user_id=$1 ORDER BY position, id', [user.id]),
  ]);
  return { user: { id: user.id, login: user.login, settings: user.settings }, activities: acts.rows, tags: tags.rows, counters: counters.rows };
});

// ---------------- activities ----------------
router.add('POST', '/api/activities', async ({ q, user, body }) => {
  const name = str(need(body.name, 'Название'), 100).trim();
  if (!isColor(body.color)) throw new HttpError(400, 'Цвет в формате #RRGGBB');
  const pos = await q.query('SELECT coalesce(max(position),-1)+1 AS p FROM activities WHERE user_id=$1', [user.id]);
  const r = await q.query('INSERT INTO activities(user_id,name,color,position,is_sleep) VALUES ($1,$2,$3,$4,$5) RETURNING *', [user.id, name, body.color.toUpperCase(), pos.rows[0].p, !!body.is_sleep]);
  return r.rows[0];
});
router.add('PUT', '/api/activities/order', async ({ q, user, body }) => {
  const ids = (body.ids || []).map((x) => int(x));
  await tx(q, async (c) => { for (let i = 0; i < ids.length; i++) await c.query('UPDATE activities SET position=$1 WHERE id=$2 AND user_id=$3', [i, ids[i], user.id]); });
  return { ok: true };
});
router.add('PUT', '/api/activities/:id', async ({ q, user, body, params }) => {
  const id = int(params.id);
  const cur = await q.query('SELECT * FROM activities WHERE id=$1 AND user_id=$2', [id, user.id]);
  if (!cur.rowCount) throw new HttpError(404, 'Занятие не найдено');
  const a = cur.rows[0];
  const name = body.name !== undefined ? str(body.name, 100).trim() : a.name;
  const color = body.color !== undefined ? (isColor(body.color) ? body.color.toUpperCase() : (() => { throw new HttpError(400, 'Цвет'); })()) : a.color;
  const r = await q.query('UPDATE activities SET name=$1, color=$2, is_sleep=$3, archived=$4 WHERE id=$5 AND user_id=$6 RETURNING *',
    [name, color, body.is_sleep !== undefined ? !!body.is_sleep : a.is_sleep, body.archived !== undefined ? !!body.archived : a.archived, id, user.id]);
  return r.rows[0];
});
router.add('DELETE', '/api/activities/:id', async ({ q, user, params }) => {
  const id = int(params.id);
  const used = await q.query('SELECT count(*)::int n FROM events WHERE activity_id=$1 AND user_id=$2', [id, user.id]);
  if (used.rows[0].n > 0) {
    // занятие с записями не удаляем, а архивируем
    await q.query('UPDATE activities SET archived=true WHERE id=$1 AND user_id=$2', [id, user.id]);
    return { ok: true, archived: true, used: used.rows[0].n };
  }
  const del = await q.query('DELETE FROM activities WHERE id=$1 AND user_id=$2 RETURNING id', [id, user.id]);
  if (!del.rowCount) throw new HttpError(404, 'Занятие не найдено');
  return { ok: true };
});

// ---------------- tags ----------------
router.add('POST', '/api/tags', async ({ q, user, body }) => {
  const aid = int(body.activity_id, 'activity_id');
  const own = await q.query('SELECT 1 FROM activities WHERE id=$1 AND user_id=$2', [aid, user.id]);
  if (!own.rowCount) throw new HttpError(404, 'Занятие не найдено');
  const pos = await q.query('SELECT coalesce(max(position),-1)+1 p FROM tags WHERE activity_id=$1 AND user_id=$2', [aid, user.id]);
  const r = await q.query('INSERT INTO tags(user_id, activity_id, name, position) VALUES ($1,$2,$3,$4) RETURNING *', [user.id, aid, str(need(body.name, 'Название'), 100).trim(), pos.rows[0].p]);
  return r.rows[0];
});
router.add('PUT', '/api/tags/:id', async ({ q, user, body, params }) => {
  const r = await q.query('UPDATE tags SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING *', [str(need(body.name, 'Название'), 100).trim(), int(params.id), user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Тег не найден');
  return r.rows[0];
});
router.add('DELETE', '/api/tags/:id', async ({ q, user, params }) => { await q.query('DELETE FROM tags WHERE id=$1 AND user_id=$2', [int(params.id), user.id]); return { ok: true }; });

// ---------------- counters ----------------
router.add('POST', '/api/counters', async ({ q, user, body }) => {
  const pos = await q.query('SELECT coalesce(max(position),-1)+1 p FROM counters WHERE user_id=$1', [user.id]);
  const r = await q.query('INSERT INTO counters(user_id,name,unit,position) VALUES ($1,$2,$3,$4) RETURNING *', [user.id, str(need(body.name, 'Название'), 100).trim(), str(body.unit, 20), pos.rows[0].p]);
  return r.rows[0];
});
router.add('PUT', '/api/counters/order', async ({ q, user, body }) => {
  const ids = (body.ids || []).map((x) => int(x));
  await tx(q, async (c) => { for (let i = 0; i < ids.length; i++) await c.query('UPDATE counters SET position=$1 WHERE id=$2 AND user_id=$3', [i, ids[i], user.id]); });
  return { ok: true };
});
router.add('PUT', '/api/counters/:id', async ({ q, user, body, params }) => {
  const r = await q.query('UPDATE counters SET name=coalesce($1,name), unit=coalesce($2,unit) WHERE id=$3 AND user_id=$4 RETURNING *', [body.name != null ? str(body.name, 100).trim() : null, body.unit != null ? str(body.unit, 20) : null, int(params.id), user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Счётчик не найден');
  return r.rows[0];
});
router.add('DELETE', '/api/counters/:id', async ({ q, user, params }) => { await q.query('DELETE FROM counters WHERE id=$1 AND user_id=$2', [int(params.id), user.id]); return { ok: true }; });
// Суммы по счётчику: помесячно (для страницы счётчиков)
router.add('GET', '/api/counters/:id/stats', async ({ q, user, params }) => {
  const own = await q.query('SELECT 1 FROM counters WHERE id=$1 AND user_id=$2', [int(params.id), user.id]);
  if (!own.rowCount) throw new HttpError(404, 'Счётчик не найден');
  const r = await q.query(`SELECT to_char(day,'YYYY-MM') ym, sum(counter_value)::float total, count(*)::int n
      FROM events WHERE user_id=$1 AND kind='counter' AND counter_id=$2 GROUP BY 1 ORDER BY 1 DESC LIMIT 24`, [user.id, int(params.id)]);
  const all = await q.query(`SELECT coalesce(sum(counter_value),0)::float total, count(*)::int n FROM events WHERE user_id=$1 AND kind='counter' AND counter_id=$2`, [user.id, int(params.id)]);
  return { months: r.rows, total: all.rows[0].total, n: all.rows[0].n };
});

// ---------------- events ----------------
const EVENT_COLS = 'id, kind, day, hours, days, position, activity_id, tag_id, text, mood, kcal, protein, fat, carbs, food_calc, counter_id, counter_value, done, done_at, created_at, updated_at';
function fmtEvent(e) {
  e.day = dateStr(e.day);
  if (e.days) e.days = e.days.map(dateStr);
  for (const k of ['kcal', 'protein', 'fat', 'carbs', 'counter_value']) if (e[k] != null) e[k] = Number(e[k]);
  return e;
}

async function eventsInRange(q, userId, from, to) {
  const r = await q.query(`SELECT ${EVENT_COLS} FROM events WHERE user_id=$1 AND (
      (day BETWEEN $2 AND $3) OR (kind='task' AND days && (SELECT array_agg(d::date) FROM generate_series($2::date, $3::date, '1 day') d)))
      ORDER BY day, position, id`, [userId, from, to]);
  const files = await q.query('SELECT id, event_id, name, mime, size FROM files WHERE user_id=$1 AND event_id IS NOT NULL AND event_id = ANY($2::bigint[])', [userId, r.rows.map((e) => e.id)]);
  const byEvent = {};
  for (const f of files.rows) (byEvent[f.event_id] = byEvent[f.event_id] || []).push(f);
  return r.rows.map((e) => { e.files = byEvent[e.id] || []; return fmtEvent(e); });
}

// Незавершённые задачи прошлых месяцев переносятся на первый день текущего месяца.
// today приходит от клиента, чтобы месяц считался по часовому поясу устройства.
const carriedFor = new Map();
async function carryTasks(q, userId, today) {
  if (!isDate(today)) return;
  const first = `${today.slice(0, 7)}-01`;
  if (carriedFor.get(userId) === first) return;
  carriedFor.set(userId, first);
  await q.query(`UPDATE events SET day=$2, days=ARRAY[$2::date], hours=NULL, updated_at=now()
      WHERE user_id=$1 AND kind='task' AND done=false AND days IS NOT NULL
        AND (SELECT max(d) FROM unnest(days) d) < $2::date`, [userId, first]);
}

router.add('GET', '/api/events', async ({ q, user, query }) => {
  if (!isDate(query.from) || !isDate(query.to)) throw new HttpError(400, 'from/to в формате YYYY-MM-DD');
  if (query.today) await carryTasks(q, user.id, query.today);
  return { events: await eventsInRange(q, user.id, query.from, query.to) };
});

function validateEvent(e) {
  const kinds = ['activity', 'task', 'food', 'thought', 'counter'];
  if (!kinds.includes(e.kind)) throw new HttpError(400, 'Неизвестный тип события');
  const out = { kind: e.kind, text: str(e.text, 20000), position: e.position != null ? int(e.position) : 0 };
  if (e.kind === 'task') {
    const days = Array.isArray(e.days) ? e.days.filter(isDate) : [];
    if (!days.length) throw new HttpError(400, 'У задачи должны быть дни');
    out.days = [...new Set(days)].sort(); out.day = out.days[0];
    // задача может быть привязана к часам — если её добавили из конкретного часа одного дня
    const th = Array.isArray(e.hours) ? e.hours.map((x) => int(x)).filter((x) => x >= 0 && x <= 23) : [];
    out.hours = out.days.length === 1 && th.length ? [...new Set(th)].sort((a, b) => a - b) : null;
  } else {
    if (!isDate(e.day)) throw new HttpError(400, 'Нужен день');
    const hours = Array.isArray(e.hours) ? e.hours.map((h) => int(h)).filter((h) => h >= 0 && h <= 23) : [];
    if (!hours.length) throw new HttpError(400, 'Нужны часы');
    out.day = e.day; out.hours = [...new Set(hours)].sort((a, b) => a - b); out.days = null;
  }
  out.activity_id = e.activity_id != null && e.activity_id !== '' ? int(e.activity_id) : null;
  out.tag_id = e.tag_id != null && e.tag_id !== '' ? int(e.tag_id) : null;
  out.mood = e.kind === 'thought' && ['sad', 'neutral', 'happy'].includes(e.mood) ? e.mood : (e.kind === 'thought' ? 'neutral' : null);
  for (const k of ['kcal', 'protein', 'fat', 'carbs']) out[k] = e.kind === 'food' && e[k] != null && e[k] !== '' ? Number(e[k]) : null;
  out.food_calc = e.kind === 'food' && e.food_calc ? JSON.stringify(e.food_calc) : null;
  out.counter_id = e.kind === 'counter' && e.counter_id != null ? int(e.counter_id) : null;
  out.counter_value = e.kind === 'counter' && e.counter_value != null && e.counter_value !== '' ? Number(e.counter_value) : null;
  if (e.kind === 'counter' && (out.counter_id == null || out.counter_value == null || Number.isNaN(out.counter_value))) throw new HttpError(400, 'Для счётчика нужны счётчик и значение');
  out.done = !!e.done;
  return out;
}

async function ownsRefs(c, userId, ev) {
  if (ev.activity_id != null) { const r = await c.query('SELECT 1 FROM activities WHERE id=$1 AND user_id=$2', [ev.activity_id, userId]); if (!r.rowCount) throw new HttpError(400, 'Занятие не найдено'); }
  if (ev.tag_id != null) { const r = await c.query('SELECT 1 FROM tags WHERE id=$1 AND user_id=$2', [ev.tag_id, userId]); if (!r.rowCount) throw new HttpError(400, 'Тег не найден'); }
  if (ev.counter_id != null) { const r = await c.query('SELECT 1 FROM counters WHERE id=$1 AND user_id=$2', [ev.counter_id, userId]); if (!r.rowCount) throw new HttpError(400, 'Счётчик не найден'); }
}

const INSERT_SQL = `INSERT INTO events(user_id, kind, day, hours, days, position, activity_id, tag_id, text, mood, kcal, protein, fat, carbs, food_calc, counter_id, counter_value, done, done_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, CASE WHEN $18 THEN now() ELSE NULL END) RETURNING ${EVENT_COLS}`;
const UPDATE_SQL = `UPDATE events SET kind=$3, day=$4, hours=$5, days=$6, position=$7, activity_id=$8, tag_id=$9, text=$10, mood=$11, kcal=$12, protein=$13, fat=$14, carbs=$15, food_calc=$16, counter_id=$17, counter_value=$18,
  done=$19, done_at = CASE WHEN $19 AND done_at IS NULL THEN now() WHEN NOT $19 THEN NULL ELSE done_at END, updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING ${EVENT_COLS}`;
function insertParams(userId, v) { return [userId, v.kind, v.day, v.hours, v.days, v.position, v.activity_id, v.tag_id, v.text, v.mood, v.kcal, v.protein, v.fat, v.carbs, v.food_calc, v.counter_id, v.counter_value, v.done]; }
function updateParams(id, userId, v) { return [id, userId, v.kind, v.day, v.hours, v.days, v.position, v.activity_id, v.tag_id, v.text, v.mood, v.kcal, v.protein, v.fat, v.carbs, v.food_calc, v.counter_id, v.counter_value, v.done]; }

// Пакетное сохранение экрана «добавить»: upsert + delete в одной транзакции
router.add('POST', '/api/events/batch', async ({ q, user, body }) => {
  const upsert = Array.isArray(body.upsert) ? body.upsert : [];
  const del = Array.isArray(body.delete) ? body.delete.map((x) => int(x)) : [];
  const saved = await tx(q, async (c) => {
    const out = [];
    if (del.length) await c.query('DELETE FROM events WHERE user_id=$1 AND id = ANY($2::bigint[])', [user.id, del]);
    for (const e of upsert) {
      const v = validateEvent(e);
      await ownsRefs(c, user.id, v);
      let r;
      if (e.id) r = await c.query(UPDATE_SQL, updateParams(int(e.id), user.id, v));
      else r = await c.query(INSERT_SQL, insertParams(user.id, v));
      if (r.rowCount) out.push(fmtEvent(r.rows[0]));
    }
    return out;
  });
  return { events: saved };
});
router.add('POST', '/api/events', async ({ q, user, body }) => {
  const v = validateEvent(body);
  return tx(q, async (c) => { await ownsRefs(c, user.id, v); const r = await c.query(INSERT_SQL, insertParams(user.id, v)); return fmtEvent(r.rows[0]); });
});
router.add('PUT', '/api/events/:id', async ({ q, user, body, params }) => {
  const id = int(params.id);
  const cur = await q.query(`SELECT ${EVENT_COLS} FROM events WHERE id=$1 AND user_id=$2`, [id, user.id]);
  if (!cur.rowCount) throw new HttpError(404, 'Событие не найдено');
  const merged = { ...fmtEvent(cur.rows[0]), ...body };
  const v = validateEvent(merged);
  return tx(q, async (c) => { await ownsRefs(c, user.id, v); const r = await c.query(UPDATE_SQL, updateParams(id, user.id, v)); return fmtEvent(r.rows[0]); });
});
router.add('DELETE', '/api/events/:id', async ({ q, user, params }) => {
  const r = await q.query('DELETE FROM events WHERE id=$1 AND user_id=$2 RETURNING id', [int(params.id), user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Событие не найдено');
  return { ok: true };
});
// Лента мыслей (страница «мысли»)
router.add('GET', '/api/thoughts', async ({ q, user, query }) => {
  const limit = Math.min(int(query.limit || 200), 1000);
  const r = await q.query(`SELECT ${EVENT_COLS} FROM events WHERE user_id=$1 AND kind='thought' ORDER BY day DESC, hours[1] DESC, id DESC LIMIT $2`, [user.id, limit]);
  return { events: r.rows.map(fmtEvent) };
});

// ---------------- food calc ----------------
router.add('POST', '/api/food/calc', async ({ q, body }) => food.calc(str(body.text, 5000)));

// Подсказки по ранее введённым строкам еды: записи режем на отдельные продукты
// (переводы строки, запятые, точки с запятой) и отдаём самые свежие совпадения.
// Сначала идут строки, начинающиеся с запроса, потом те, где он внутри.
router.add('GET', '/api/food/suggest', async ({ q, user, query }) => {
  const term = str(query.q, 100).trim();
  if (term.length < 2) return { items: [] };
  const esc = term.replace(/[%_\\]/g, (m) => '\\' + m);
  const r = await q.query(`
    WITH parts AS (
      SELECT btrim(regexp_replace(p, '\\s+', ' ', 'g')) AS line, e.day, e.id
        FROM events e, regexp_split_to_table(e.text, '[\n;,]+') AS p
       WHERE e.user_id = $1 AND e.kind = 'food' AND e.text IS NOT NULL
    ), uniq AS (
      SELECT line, max(day) AS last_day, max(id) AS last_id, count(*)::int AS n
        FROM parts
       WHERE char_length(line) BETWEEN 2 AND 120 AND (line ILIKE $2 OR line ILIKE $3)
       GROUP BY line
    )
    SELECT line, n FROM uniq
     ORDER BY (line ILIKE $2) DESC, last_day DESC, last_id DESC
     LIMIT 50`, [user.id, esc + '%', '%' + esc + '%']);
  return { items: r.rows.map((x) => ({ line: x.line, n: x.n })) };
});

// ---------------- important dates ----------------
router.add('GET', '/api/dates', async ({ q, user }) => {
  const r = await q.query('SELECT id, day, yearly, title FROM important_dates WHERE user_id=$1 ORDER BY day', [user.id]);
  return { dates: r.rows.map((d) => ({ ...d, day: dateStr(d.day) })) };
});
router.add('POST', '/api/dates', async ({ q, user, body }) => {
  if (!isDate(body.day)) throw new HttpError(400, 'Дата');
  const r = await q.query('INSERT INTO important_dates(user_id, day, yearly, title) VALUES ($1,$2,$3,$4) RETURNING id, day, yearly, title', [user.id, body.day, !!body.yearly, str(body.title, 300).trim()]);
  return { ...r.rows[0], day: dateStr(r.rows[0].day) };
});
router.add('PUT', '/api/dates/:id', async ({ q, user, body, params }) => {
  const cur = await q.query('SELECT * FROM important_dates WHERE id=$1 AND user_id=$2', [int(params.id), user.id]);
  if (!cur.rowCount) throw new HttpError(404, 'Не найдено');
  const d = cur.rows[0];
  const day = body.day !== undefined ? (isDate(body.day) ? body.day : (() => { throw new HttpError(400, 'Дата'); })()) : dateStr(d.day);
  const r = await q.query('UPDATE important_dates SET day=$1, yearly=$2, title=$3 WHERE id=$4 AND user_id=$5 RETURNING id, day, yearly, title', [day, body.yearly !== undefined ? !!body.yearly : d.yearly, body.title !== undefined ? str(body.title, 300).trim() : d.title, d.id, user.id]);
  return { ...r.rows[0], day: dateStr(r.rows[0].day) };
});
router.add('DELETE', '/api/dates/:id', async ({ q, user, params }) => { await q.query('DELETE FROM important_dates WHERE id=$1 AND user_id=$2', [int(params.id), user.id]); return { ok: true }; });

// ---------------- notes ----------------
router.add('GET', '/api/notes', async ({ q, user }) => {
  const r = await q.query(`SELECT n.id, n.parent_id, n.kind, n.title, n.icon, n.position, n.updated_at, length(n.content) AS content_length,
      (SELECT count(*)::int FROM files f WHERE f.note_id = n.id) AS files_count
      FROM notes n WHERE n.user_id=$1 ORDER BY n.parent_id NULLS FIRST, n.position, n.id`, [user.id]);
  return { notes: r.rows };
});
router.add('GET', '/api/notes/:id', async ({ q, user, params }) => {
  const id = int(params.id);
  const r = await q.query('SELECT id, parent_id, kind, title, icon, content, position, created_at, updated_at FROM notes WHERE id=$1 AND user_id=$2', [id, user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Заметка не найдена');
  const files = await q.query('SELECT id, name, mime, size, created_at FROM files WHERE note_id=$1 AND user_id=$2 ORDER BY id', [id, user.id]);
  const revs = await q.query('SELECT id, created_at, length(content) len FROM note_revisions WHERE note_id=$1 AND created_at > now() - interval \'30 minutes\' ORDER BY created_at DESC', [id]);
  return { note: r.rows[0], files: files.rows, revisions: revs.rows };
});
async function checkParent(q, userId, parentId) {
  if (parentId == null) return null;
  const p = await q.query('SELECT id, kind FROM notes WHERE id=$1 AND user_id=$2', [parentId, userId]);
  if (!p.rowCount) throw new HttpError(400, 'Родитель не найден');
  return p.rows[0].id;
}
router.add('POST', '/api/notes', async ({ q, user, body }) => {
  const kind = body.kind === 'folder' ? 'folder' : 'note';
  const parent = await checkParent(q, user.id, body.parent_id != null ? int(body.parent_id) : null);
  const pos = await q.query('SELECT coalesce(max(position),-1)+1 p FROM notes WHERE user_id=$1 AND parent_id IS NOT DISTINCT FROM $2', [user.id, parent]);
  const r = await q.query('INSERT INTO notes(user_id, parent_id, kind, title, icon, content, position) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, parent_id, kind, title, icon, position, updated_at',
    [user.id, parent, kind, str(body.title, 300).trim() || (kind === 'folder' ? 'новая папка' : 'новая заметка'), str(body.icon, 40), str(body.content, 1000000), pos.rows[0].p]);
  return r.rows[0];
});
router.add('PUT', '/api/notes/:id', async ({ q, user, body, params }) => {
  const id = int(params.id);
  return tx(q, async (c) => {
    const cur = await c.query('SELECT * FROM notes WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, user.id]);
    if (!cur.rowCount) throw new HttpError(404, 'Заметка не найдена');
    const n = cur.rows[0];
    let parent = n.parent_id, position = n.position;
    if (body.parent_id !== undefined) {
      parent = await checkParent(q, user.id, body.parent_id != null ? int(body.parent_id) : null);
      // нельзя переместить папку внутрь самой себя
      if (parent != null) {
        const cyc = await c.query(`WITH RECURSIVE up AS (SELECT id, parent_id FROM notes WHERE id=$1 AND user_id=$3 UNION ALL SELECT n.id, n.parent_id FROM notes n JOIN up ON n.id = up.parent_id) SELECT 1 FROM up WHERE id=$2`, [parent, id, user.id]);
        if (cyc.rowCount) throw new HttpError(400, 'Нельзя вложить папку в саму себя');
      }
      if (parent !== n.parent_id) {
        const pos = await c.query('SELECT coalesce(max(position),-1)+1 p FROM notes WHERE user_id=$1 AND parent_id IS NOT DISTINCT FROM $2', [user.id, parent]);
        position = pos.rows[0].p;
      }
    }
    if (body.position !== undefined) position = int(body.position);
    const content = body.content !== undefined ? str(body.content, 1000000) : n.content;
    const title = body.title !== undefined ? str(body.title, 300).trim() : n.title;
    if (content !== n.content || title !== n.title) {
      // ревизия для отмены: не чаще одной в минуту, храним 30 минут
      const last = await c.query('SELECT created_at FROM note_revisions WHERE note_id=$1 ORDER BY created_at DESC LIMIT 1', [id]);
      if (!last.rowCount || Date.now() - new Date(last.rows[0].created_at).getTime() > 60 * 1000) {
        await c.query('INSERT INTO note_revisions(note_id, content, title) VALUES ($1,$2,$3)', [id, n.content, n.title]);
      }
      await c.query('DELETE FROM note_revisions WHERE note_id=$1 AND created_at < now() - interval \'30 minutes\'', [id]);
    }
    const r = await c.query('UPDATE notes SET parent_id=$1, position=$2, title=$3, icon=$4, content=$5, updated_at=CASE WHEN $5 <> content OR $3 <> title THEN now() ELSE updated_at END WHERE id=$6 AND user_id=$7 RETURNING id, parent_id, kind, title, icon, position, updated_at',
      [parent, position, title, body.icon !== undefined ? str(body.icon, 40) : n.icon, content, id, user.id]);
    return r.rows[0];
  });
});
router.add('POST', '/api/notes/:id/restore', async ({ q, user, body, params }) => {
  const id = int(params.id);
  const rev = await q.query('SELECT r.* FROM note_revisions r JOIN notes n ON n.id = r.note_id WHERE r.id=$1 AND n.id=$2 AND n.user_id=$3', [int(body.revision_id), id, user.id]);
  if (!rev.rowCount) throw new HttpError(404, 'Версия не найдена');
  const r = await q.query('UPDATE notes SET content=$1, title=$2, updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING id, title, content, updated_at', [rev.rows[0].content, rev.rows[0].title, id, user.id]);
  return r.rows[0];
});
router.add('DELETE', '/api/notes/:id', async ({ q, user, params }) => {
  const id = int(params.id);
  // удаляем файлы с диска для всего поддерева
  const files = await q.query(`WITH RECURSIVE t AS (SELECT id FROM notes WHERE id=$1 AND user_id=$2 UNION ALL SELECT n.id FROM notes n JOIN t ON n.parent_id = t.id)
      SELECT f.storage_key FROM files f WHERE f.note_id IN (SELECT id FROM t)`, [id, user.id]);
  const r = await q.query('DELETE FROM notes WHERE id=$1 AND user_id=$2 RETURNING id', [id, user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Заметка не найдена');
  for (const f of files.rows) fs.promises.unlink(path.join(config.uploadDir, f.storage_key)).catch(() => {});
  return { ok: true };
});

// ---------------- files ----------------
// Загрузка: тело запроса = содержимое файла; имя/тип/привязка — в query.
router.add('POST', '/api/files', async ({ q, user, req, query }) => {
  const name = str(query.name || 'file', 200).replace(/[/\\]/g, '_');
  const mime = str(query.mime || req.headers['content-type'] || 'application/octet-stream', 100).split(';')[0];
  const noteId = query.note_id ? int(query.note_id) : null;
  const eventId = query.event_id ? int(query.event_id) : null;
  if (noteId) { const r = await q.query('SELECT 1 FROM notes WHERE id=$1 AND user_id=$2', [noteId, user.id]); if (!r.rowCount) throw new HttpError(404, 'Заметка не найдена'); }
  if (eventId) { const r = await q.query('SELECT 1 FROM events WHERE id=$1 AND user_id=$2', [eventId, user.id]); if (!r.rowCount) throw new HttpError(404, 'Событие не найдено'); }
  const buf = await readBody(req, config.maxUploadBytes);
  if (!buf.length) throw new HttpError(400, 'Пустой файл');
  const ext = path.extname(name).toLowerCase().slice(0, 10);
  const key = path.join(String(user.id), new Date().toISOString().slice(0, 7), crypto.randomBytes(12).toString('hex') + ext);
  const full = path.join(config.uploadDir, key);
  await fs.promises.mkdir(path.dirname(full), { recursive: true });
  await fs.promises.writeFile(full, buf);
  const r = await q.query('INSERT INTO files(user_id, note_id, event_id, name, mime, size, storage_key) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, note_id, event_id, name, mime, size, created_at', [user.id, noteId, eventId, name, mime, buf.length, key]);
  return r.rows[0];
});
router.add('PUT', '/api/files/:id', async ({ q, user, body, params }) => {
  // привязка файла к событию после его создания
  const r = await q.query('UPDATE files SET event_id=coalesce($1,event_id), note_id=coalesce($2,note_id) WHERE id=$3 AND user_id=$4 RETURNING id, note_id, event_id, name, mime, size', [body.event_id != null ? int(body.event_id) : null, body.note_id != null ? int(body.note_id) : null, int(params.id), user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Файл не найден');
  return r.rows[0];
});
router.add('GET', '/api/files/:id', async ({ q, user, params, query, res }) => {
  const r = await q.query('SELECT * FROM files WHERE id=$1 AND user_id=$2', [int(params.id), user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Файл не найден');
  const f = r.rows[0];
  const full = path.join(config.uploadDir, f.storage_key);
  if (!fs.existsSync(full)) throw new HttpError(404, 'Файл отсутствует на диске');
  const safeMime = /^(image|audio|video)\//.test(f.mime) || f.mime === 'application/pdf' ? f.mime : 'application/octet-stream';
  const disposition = query.download ? 'attachment' : 'inline';
  res.writeHead(200, {
    'Content-Type': safeMime,
    'Content-Length': Number(f.size),
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(full).pipe(res);
  return undefined; // ответ уже отправлен
});
router.add('DELETE', '/api/files/:id', async ({ q, user, params }) => {
  const r = await q.query('DELETE FROM files WHERE id=$1 AND user_id=$2 RETURNING storage_key', [int(params.id), user.id]);
  if (!r.rowCount) throw new HttpError(404, 'Файл не найден');
  fs.promises.unlink(path.join(config.uploadDir, r.rows[0].storage_key)).catch(() => {});
  return { ok: true };
});

// ---------------- search ----------------
router.add('GET', '/api/search', async ({ q, user, query }) => {
  const term = str(query.q, 200).trim();
  if (term.length < 2) return { events: [], notes: [], dates: [], activities: [] };
  // websearch_to_tsquery понимает фразы в кавычках и минус; плюс префиксное совпадение по последнему слову и ILIKE как подстраховка
  const like = '%' + term.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
  const words = term.split(/\s+/).filter(Boolean).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const prefix = words.length ? words.map((w) => w + ':*').join(' & ') : null;
  const [events, notes, dates, acts] = await Promise.all([
    q.query(`SELECT ${EVENT_COLS}, ts_rank(tsv, websearch_to_tsquery('russian', $2)) AS rank
        FROM events WHERE user_id=$1 AND (tsv @@ websearch_to_tsquery('russian', $2) OR ($3::text IS NOT NULL AND tsv @@ to_tsquery('russian', $3)) OR text ILIKE $4)
        ORDER BY rank DESC, day DESC LIMIT 100`, [user.id, term, prefix, like]),
    q.query(`SELECT id, parent_id, kind, title, icon, updated_at, ts_headline('russian', content, websearch_to_tsquery('russian', $2), 'MaxWords=18, MinWords=6, MaxFragments=1') AS snippet,
        ts_rank(tsv, websearch_to_tsquery('russian', $2)) AS rank
        FROM notes WHERE user_id=$1 AND (tsv @@ websearch_to_tsquery('russian', $2) OR ($3::text IS NOT NULL AND tsv @@ to_tsquery('russian', $3)) OR title ILIKE $4 OR content ILIKE $4)
        ORDER BY rank DESC, updated_at DESC LIMIT 50`, [user.id, term, prefix, like]),
    q.query(`SELECT id, day, yearly, title FROM important_dates WHERE user_id=$1 AND (tsv @@ websearch_to_tsquery('russian', $2) OR title ILIKE $3) ORDER BY day LIMIT 50`, [user.id, term, like]),
    q.query(`SELECT a.id, a.name, a.color, count(e.id)::int AS n FROM activities a LEFT JOIN events e ON e.activity_id = a.id
        WHERE a.user_id=$1 AND a.name ILIKE $2 GROUP BY a.id ORDER BY a.position LIMIT 20`, [user.id, like]),
  ]);
  return {
    events: events.rows.map(fmtEvent),
    notes: notes.rows,
    dates: dates.rows.map((d) => ({ ...d, day: dateStr(d.day) })),
    activities: acts.rows,
  };
});

module.exports = { router, COOKIE };
