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

// цвет старой версии → название занятия в новой (создаётся, если нет)
const COLOR_TO_ACTIVITY = {
  green: { name: 'работа', color: '#73D383' },
  sleep: { name: 'сон', color: '#262626', is_sleep: true },
  blue: { name: 'учеба', color: '#476FAF' },
  purple: { name: 'семья', color: '#51006C' },
  pink: { name: 'развлечения', color: '#FF81BC' },
  red: { name: 'спорт', color: '#B71506' },
  olive: { name: 'рутина', color: '#AA952E' },
  white: { name: 'прочее', color: '#DEDEDE' },
};

function doyToDate(year, doy) {
  const d = new Date(Date.UTC(year, 0, doy));
  return d.toISOString().slice(0, 10);
}

function runs(hours) {
  // [1,2,3,7,8] → [[1,2,3],[7,8]]
  const out = [];
  for (const h of [...hours].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === h - 1) last.push(h); else out.push([h]);
  }
  return out;
}

async function main() {
  const [login, file] = process.argv.slice(2);
  if (!login || !file) { console.error('Использование: node scripts/import-legacy.js "Логин" backup.json'); process.exit(1); }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const u = await db.query('SELECT id FROM users WHERE login_norm=$1', [auth.normalizeLogin(login)]);
  if (!u.rowCount) throw new Error(`Пользователь «${login}» не найден. Создайте его: node scripts/create-user.js`);
  const userId = u.rows[0].id;

  const stats = { activityEvents: 0, withText: 0, tasks: 0, hours: 0, createdActivities: [] };

  await db.tx(async (c) => {
    // занятия пользователя
    const acts = await c.query('SELECT id, name, color FROM activities WHERE user_id=$1', [userId]);
    const byName = new Map(acts.rows.map((a) => [a.name.toLowerCase(), a.id]));
    const activityFor = async (colorKey) => {
      const def = COLOR_TO_ACTIVITY[colorKey];
      if (!def) throw new Error(`Неизвестный цвет в выгрузке: ${colorKey}`);
      if (byName.has(def.name)) return byName.get(def.name);
      const pos = await c.query('SELECT coalesce(max(position),-1)+1 p FROM activities WHERE user_id=$1', [userId]);
      const r = await c.query('INSERT INTO activities(user_id,name,color,position,is_sleep) VALUES ($1,$2,$3,$4,$5) RETURNING id', [userId, def.name, def.color, pos.rows[0].p, !!def.is_sleep]);
      byName.set(def.name, r.rows[0].id);
      stats.createdActivities.push(def.name);
      return r.rows[0].id;
    };

    const insert = async (ev) => {
      await c.query(`INSERT INTO events(user_id, kind, day, hours, days, position, activity_id, text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [userId, ev.kind, ev.day, ev.hours || null, ev.days || null, ev.position || 0, ev.activity_id || null, ev.text || '']);
    };

    for (const y of data.years || []) {
      const year = Number(y.year);
      for (const day of y.days || []) {
        const hours = day.hours || [];
        if (!hours.some((h) => h && h.color)) continue;
        const date = doyToDate(year, day.doy);
        const used = new Set();
        // 1) часы с заметками → одно событие на заметку
        for (const [, note] of Object.entries(day.notes || {})) {
          const hs = (note.hours || []).filter((h) => hours[h] && hours[h].color);
          if (!hs.length) continue;
          const colors = {};
          for (const h of hs) colors[hours[h].color] = (colors[hours[h].color] || 0) + 1;
          const color = Object.entries(colors).sort((a, b) => b[1] - a[1])[0][0];
          await insert({ kind: 'activity', day: date, hours: hs.sort((a, b) => a - b), activity_id: await activityFor(color), text: note.text || '' });
          hs.forEach((h) => used.add(h));
          stats.activityEvents++; stats.withText++; stats.hours += hs.length;
        }
        // 2) остальные закрашенные часы → события по непрерывным отрезкам одного цвета
        const byColor = {};
        hours.forEach((h, i) => { if (h && h.color && !used.has(i)) (byColor[h.color] = byColor[h.color] || []).push(i); });
        for (const [color, hs] of Object.entries(byColor)) {
          for (const run of runs(hs)) {
            await insert({ kind: 'activity', day: date, hours: run, activity_id: await activityFor(color), text: '' });
            stats.activityEvents++; stats.hours += run.length;
          }
        }
      }
      // план → задачи
      const plan = y.plan || {};
      for (const [nid, note] of Object.entries(plan.notes || {})) {
        const days = (note.days || []).map((d) => doyToDate(year, d));
        if (!days.length) continue;
        const cell = (plan.days || [])[note.days[0] - 1];
        const color = cell && cell.color;
        await insert({ kind: 'task', day: days[0], days: [...new Set(days)].sort(), activity_id: color ? await activityFor(color) : null, text: note.text || '', position: Number(nid) || 0 });
        stats.tasks++;
      }
    }
  });

  console.log(`Импорт в аккаунт «${login}» завершён:`);
  console.log(`  событий-занятий: ${stats.activityEvents} (с текстом: ${stats.withText}), часов: ${stats.hours}`);
  console.log(`  задач: ${stats.tasks}`);
  if (stats.createdActivities.length) console.log(`  созданы занятия: ${stats.createdActivities.join(', ')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error('Ошибка импорта:', e.message || e); process.exit(1); });
