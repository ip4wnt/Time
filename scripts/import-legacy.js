#!/usr/bin/env node
'use strict';
// Импорт выгрузки старого трекера (time-tracker-backup-*.json) в аккаунт пользователя.
// Использование: node scripts/import-legacy.js "Логин" путь/к/backup.json
//
// Старая модель: год → дни (doy 1..365/366) → 24 часа {color, noteId}; заметки {text, hours[]}.
// План: год → days[doy-1] {color, noteId}; заметки {text, days[doy]}.
// Новая модель: события kind=activity (день, часы, занятие, текст) и kind=task (массив дней, текст).
const fs = require('node:fs');
const db = require('../server/db');
const auth = require('../server/auth');

const { COLOR_TO_ACTIVITY, parseLegacy } = require('./legacy-transform');

async function main() {
  const [login, file] = process.argv.slice(2);
  if (!login || !file) { console.error('Использование: node scripts/import-legacy.js "Логин" backup.json'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const u = await db.query('SELECT id FROM users WHERE login_norm=$1', [auth.normalizeLogin(login)]);
  if (!u.rowCount) throw new Error(`Пользователь «${login}» не найден. Создайте его: node scripts/create-user.js`);
  const userId = u.rows[0].id;

  const { events, colors, stats } = parseLegacy(data);
  const created = [];

  await db.tx(async (c) => {
    const acts = await c.query('SELECT id, name FROM activities WHERE user_id=$1', [userId]);
    const byName = new Map(acts.rows.map((a) => [a.name.toLowerCase(), a.id]));
    const actId = {};
    for (const key of colors) {
      const def = COLOR_TO_ACTIVITY[key];
      if (byName.has(def.name.toLowerCase())) { actId[key] = byName.get(def.name.toLowerCase()); continue; }
      const pos = await c.query('SELECT coalesce(max(position),-1)+1 p FROM activities WHERE user_id=$1', [userId]);
      const r = await c.query('INSERT INTO activities(user_id,name,color,position,is_sleep) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [userId, def.name, def.color, pos.rows[0].p, !!def.is_sleep]);
      actId[key] = r.rows[0].id;
      byName.set(def.name.toLowerCase(), r.rows[0].id);
      created.push(def.name);
    }
    for (const ev of events) {
      await c.query('INSERT INTO events(user_id, kind, day, hours, days, position, activity_id, text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [userId, ev.kind, ev.day, ev.hours || null, ev.days || null, ev.position || 0, ev.colorKey ? actId[ev.colorKey] : null, ev.text || '']);
    }
  });

  stats.createdActivities = created;

  console.log(`Импорт в аккаунт «${login}» завершён:`);
  console.log(`  событий-занятий: ${stats.activityEvents} (с текстом: ${stats.withText}), часов: ${stats.hours}`);
  console.log(`  задач: ${stats.tasks}`);
  if (stats.createdActivities.length) console.log(`  созданы занятия: ${stats.createdActivities.join(', ')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('Ошибка импорта:', e.message || e); process.exit(1); });
