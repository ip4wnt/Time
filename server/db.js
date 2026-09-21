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

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, query, tx, migrate };
