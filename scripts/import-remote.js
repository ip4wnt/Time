#!/usr/bin/env node
'use strict';
// Импорт выгрузки старого трекера в аккаунт на УДАЛЁННОМ сервере — через HTTP API,
// без доступа к базе. Нужен, когда файл выгрузки и сервер находятся в разных местах.
//
// Использование:
//   node scripts/import-remote.js <базовый-URL> <логин> <backup.json> "часть-вопроса=ответ" ...
// Пример:
//   node scripts/import-remote.js http://158.160.212.111 Leo backup.json "лампочк=106" "5+0=5890"

const fs = require('node:fs');
const { parseLegacy, COLOR_TO_ACTIVITY } = require('./legacy-transform');

const BATCH = 200; // событий в одном запросе

async function api(base, path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* не JSON */ }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data?.error || text.slice(0, 200)}`);
  return data;
}

async function login(base, loginName, password) {
  const r = await api(base, '/api/auth/login', { method: 'POST', body: { login: loginName, password } });
  if (r.status !== 'ok' || !r.token) throw new Error(`Не удалось войти как «${loginName}» — проверьте логин и пароль`);
  return r.token;
}

async function main() {
  const [base0, loginName, file, password] = process.argv.slice(2);
  if (!base0 || !loginName || !file || !password) {
    console.error('Использование: node scripts/import-remote.js <базовый-URL> <логин> <backup.json> <пароль>');
    process.exit(1);
  }
  const base = base0.replace(/\/+$/, '');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { events, colors, stats } = parseLegacy(data);
  console.log(`В выгрузке: событий-занятий ${stats.activityEvents} (с текстом ${stats.withText}), часов ${stats.hours}, задач ${stats.tasks}`);

  console.log(`Вход на ${base} как «${loginName}»`);
  const token = await login(base, loginName, password);

  // занятия: сопоставляем по названию, недостающие создаём
  const boot = await api(base, '/api/bootstrap', { token });
  const before = (await api(base, '/api/events?from=1970-01-01&to=2100-01-01', { token })).events.length;
  if (before) console.log(`ВНИМАНИЕ: в аккаунте уже ${before} запис(ей) — импорт добавит новые, ничего не удаляя`);
  const byName = new Map(boot.activities.map((a) => [a.name.toLowerCase(), a.id]));
  const actId = {};
  for (const key of colors) {
    const def = COLOR_TO_ACTIVITY[key];
    if (byName.has(def.name.toLowerCase())) { actId[key] = byName.get(def.name.toLowerCase()); continue; }
    const created = await api(base, '/api/activities', { method: 'POST', token, body: { name: def.name, color: def.color, is_sleep: !!def.is_sleep } });
    const newId = created.id ?? created.activity?.id;
    if (!newId) throw new Error(`Сервер не вернул id созданного занятия: ${JSON.stringify(created).slice(0, 200)}`);
    actId[key] = newId;
    byName.set(def.name.toLowerCase(), newId);
    console.log(`  создано занятие: ${def.name}`);
  }

  // отправляем события порциями
  const payload = events.map((e) => ({
    kind: e.kind,
    day: e.day,
    hours: e.hours || null,
    days: e.days || null,
    position: e.position || 0,
    activity_id: e.colorKey ? actId[e.colorKey] : null,
    text: e.text || '',
  }));
  let sent = 0;
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    await api(base, '/api/events/batch', { method: 'POST', token, body: { upsert: chunk } });
    sent += chunk.length;
    console.log(`  отправлено ${sent} / ${payload.length}`);
  }

  const check = await api(base, '/api/events?from=1970-01-01&to=2100-01-01', { token });
  console.log(`Готово. Записей в аккаунте «${loginName}»: ${check.events.length}`);
}

main().catch((e) => { console.error('Ошибка:', e.message || e); process.exit(1); });
