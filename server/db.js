'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Pool, types } = require('pg');
// bigint (int8) и numeric приходят строками — отдаём числа, чтобы фронтенд не путался
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date без времени — строкой YYYY-MM-DD, без сдвига часовых поясов
types.setTypeParser(1082, (v) => v);
const config = require('./config');

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', (err) => console.error('[db] pool error', err));

async function query(text, params) {
  return pool.query(text, params);
}

// Одна транзакция: fn получает клиент с методом query
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ===== Изоляция данных пользователей =====
// Таблицы ниже закрыты политиками RLS (sql/schema.sql): строка видна только тому,
// чей id выставлен в chronum.user_id, либо служебной транзакции (chronum.admin='on').
const PROTECTED_TABLES = ['activities', 'tags', 'counters', 'events', 'important_dates', 'notes', 'files'];
const TOUCHES_PROTECTED = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:${PROTECTED_TABLES.join('|')})\\b`, 'i');

// Второй рубеж: запрос к защищённой таблице обязан сам фильтровать по user_id.
// RLS и так не отдаст чужое, но забытое условие — признак ошибки, и о ней лучше узнать сразу.
function guard(text, opts) {
  if (opts && opts.unscoped) return;
  if (TOUCHES_PROTECTED.test(text) && !/user_id/i.test(text)) {
    throw new Error(`Запрос к защищённой таблице без user_id: ${String(text).replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  }
}

function scopedClient(client, userId) {
  return {
    userId,
    client,
    async query(text, params, opts) {
      guard(text, opts);
      return client.query(text, params);
    },
  };
}

// Транзакция от имени пользователя: политики RLS показывают только его строки.
// fn получает обёртку с .query(text, params[, { unscoped: true }]).
async function withUser(userId, fn) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('withUser: некорректный userId');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('chronum.user_id', $1, true)", [String(id)]);
    const result = await fn(scopedClient(client, id));
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// Служебная транзакция без привязки к пользователю: регистрация, импорт, очистка.
// Политики пропускают всё, поэтому здесь фильтры по user_id — целиком на совести вызывающего.
async function txAdmin(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('chronum.admin', 'on', true)");
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, query, tx, withUser, txAdmin, migrate, PROTECTED_TABLES };
