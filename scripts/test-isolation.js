#!/usr/bin/env node
'use strict';
// Автотест изоляции данных: создаёт двух пользователей, наполняет обоих,
// а затем от имени первого пробует достать и изменить всё, что принадлежит второму.
// Проверяется и уровень API, и уровень базы (политики RLS).
//
// Запуск (сервер должен быть уже запущен):
//   node scripts/test-isolation.js [базовый-URL]
// По умолчанию http://127.0.0.1:3000. Тестовые аккаунты удаляются в конце.

const db = require('../server/db');

const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const PASSWORD = 'izolyaciya-test-9137';
const suffix = Date.now().toString(36);
const LOGIN_A = `тест-изоляция-a-${suffix}`;
const LOGIN_B = `тест-изоляция-b-${suffix}`;

let passed = 0;
const failures = [];

function ok(name) { passed++; console.log(`  ок   ${name}`); }
function fail(name, detail) { failures.push(`${name} — ${detail}`); console.log(`  ПЛОХО ${name}: ${detail}`); }

async function api(token, method, path, body) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, data };
}

// Чужой запрос обязан вернуть «не найдено» или «нельзя» — и ни байта чужих данных
async function denied(name, token, method, path, body, forbiddenText) {
  const r = await api(token, method, path, body);
  const okStatus = [400, 403, 404].includes(r.status);
  const leaked = forbiddenText && JSON.stringify(r.data || {}).includes(forbiddenText);
  if (okStatus && !leaked) ok(`${name} → ${r.status}`);
  else fail(name, leaked ? `в ответе ${r.status} видны чужие данные` : `ожидался 400/403/404, получен ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
}

async function register(login) {
  const res = await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password: PASSWORD }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(`не удалось создать «${login}»: ${res.status} ${JSON.stringify(data)}`);
  return data.token;
}

// Наполняем аккаунт: занятие, тег, счётчик, событие, задача, важная дата, заметка, файл
async function seed(token, mark) {
  const act = (await api(token, 'POST', '/api/activities', { name: `занятие ${mark}`, color: '#AA3311' })).data;
  const tag = (await api(token, 'POST', '/api/tags', { activity_id: act.id, name: `тег ${mark}` })).data;
  const cnt = (await api(token, 'POST', '/api/counters', { name: `счётчик ${mark}`, unit: 'шт' })).data;
  const ev = (await api(token, 'POST', '/api/events', {
    kind: 'activity', day: '2026-09-01', hours: [9, 10], activity_id: act.id, tag_id: tag.id, text: `секрет ${mark}`,
  })).data;
  const task = (await api(token, 'POST', '/api/events', { kind: 'task', days: ['2026-09-02'], text: `задача ${mark}` })).data;
  const date = (await api(token, 'POST', '/api/dates', { day: '2026-12-31', title: `дата ${mark}` })).data;
  const note = (await api(token, 'POST', '/api/notes', { kind: 'note', title: `заметка ${mark}`, content: `секрет ${mark}` })).data;
  await api(token, 'PUT', `/api/notes/${note.id}`, { content: `секрет ${mark} обновлён` });
  const folder = (await api(token, 'POST', '/api/notes', { kind: 'folder', title: `папка ${mark}` })).data;

  // файл прикрепляем к заметке
  const upload = await fetch(`${BASE}/api/files?note_id=${note.id}&name=${encodeURIComponent(`файл-${mark}.txt`)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: `содержимое ${mark}`,
  });
  const file = await upload.json();

  const rev = (await api(token, 'GET', `/api/notes/${note.id}`)).data;
  const revisionId = rev.revisions && rev.revisions.length ? rev.revisions[0].id : null;
  return { act, tag, cnt, ev, task, date, note, folder, file, revisionId };
}

async function main() {
  console.log(`Автотест изоляции данных, сервер ${BASE}`);
  const tokenA = await register(LOGIN_A);
  const tokenB = await register(LOGIN_B);
  const a = await seed(tokenA, 'А');
  const b = await seed(tokenB, 'Б');
  const idA = (await api(tokenA, 'GET', '/api/me')).data.user.id;
  const idB = (await api(tokenB, 'GET', '/api/me')).data.user.id;
  console.log(`Созданы аккаунты: ${LOGIN_A} (id=${idA}) и ${LOGIN_B} (id=${idB})\n`);

  console.log('1. Чтение общих списков не приносит чужого');
  const boot = (await api(tokenA, 'GET', '/api/bootstrap')).data;
  const bootText = JSON.stringify(boot);
  if (bootText.includes('Б')) fail('bootstrap А', 'в выдаче встречаются пометки Б'); else ok('bootstrap А без данных Б');
  const evs = (await api(tokenA, 'GET', '/api/events?from=2026-09-01&to=2026-09-30')).data;
  if (JSON.stringify(evs).includes('секрет Б')) fail('события А', 'видны события Б'); else ok('события А без событий Б');
  const search = (await api(tokenA, 'GET', '/api/search?q=' + encodeURIComponent('секрет'))).data;
  if (JSON.stringify(search).includes('Б')) fail('поиск А', 'находит записи Б'); else ok('поиск А не находит записи Б');
  const sug = (await api(tokenA, 'GET', '/api/food/suggest?q=' + encodeURIComponent('се'))).data;
  if (JSON.stringify(sug).includes('Б')) fail('подсказки еды А', 'показывают строки Б'); else ok('подсказки еды А без строк Б');
  const th = (await api(tokenA, 'GET', '/api/thoughts')).data;
  if (JSON.stringify(th).includes('секрет Б')) fail('мысли А', 'видны мысли Б'); else ok('мысли А без мыслей Б');
  const notes = (await api(tokenA, 'GET', '/api/notes')).data;
  if (JSON.stringify(notes).includes('заметка Б')) fail('дерево заметок А', 'видна заметка Б'); else ok('дерево заметок А без заметок Б');
  const dates = (await api(tokenA, 'GET', '/api/dates')).data;
  if (JSON.stringify(dates).includes('дата Б')) fail('даты А', 'видна дата Б'); else ok('даты А без дат Б');

  console.log('\n2. Обращение к чужим записям по идентификатору');
  await denied('чтение заметки Б', tokenA, 'GET', `/api/notes/${b.note.id}`, undefined, 'секрет Б');
  await denied('правка заметки Б', tokenA, 'PUT', `/api/notes/${b.note.id}`, { content: 'взлом' });
  await denied('удаление заметки Б', tokenA, 'DELETE', `/api/notes/${b.note.id}`);
  await denied('правка события Б', tokenA, 'PUT', `/api/events/${b.ev.id}`, { text: 'взлом' });
  await denied('удаление события Б', tokenA, 'DELETE', `/api/events/${b.ev.id}`);
  await denied('правка занятия Б', tokenA, 'PUT', `/api/activities/${b.act.id}`, { name: 'взлом' });
  await denied('удаление занятия Б', tokenA, 'DELETE', `/api/activities/${b.act.id}`);
  await denied('правка тега Б', tokenA, 'PUT', `/api/tags/${b.tag.id}`, { name: 'взлом' });
  await denied('правка счётчика Б', tokenA, 'PUT', `/api/counters/${b.cnt.id}`, { name: 'взлом' });
  await denied('статистика счётчика Б', tokenA, 'GET', `/api/counters/${b.cnt.id}/stats`);
  await denied('правка даты Б', tokenA, 'PUT', `/api/dates/${b.date.id}`, { title: 'взлом' });
  await denied('скачивание файла Б', tokenA, 'GET', `/api/files/${b.file.id}`, undefined, 'содержимое Б');
  await denied('переименование файла Б', tokenA, 'PUT', `/api/files/${b.file.id}`, { name: 'взлом.txt' });
  await denied('удаление файла Б', tokenA, 'DELETE', `/api/files/${b.file.id}`);
  if (b.revisionId) await denied('откат заметки Б к версии', tokenA, 'POST', `/api/notes/${b.note.id}/restore`, { revision_id: b.revisionId });

  console.log('\n3. Попытки привязать своё к чужому');
  await denied('тег к занятию Б', tokenA, 'POST', '/api/tags', { activity_id: b.act.id, name: 'чужой тег' });
  await denied('событие с занятием Б', tokenA, 'POST', '/api/events', { kind: 'activity', day: '2026-09-03', hours: [8], activity_id: b.act.id });
  await denied('событие с тегом Б', tokenA, 'POST', '/api/events', { kind: 'activity', day: '2026-09-03', hours: [8], activity_id: a.act.id, tag_id: b.tag.id });
  await denied('событие со счётчиком Б', tokenA, 'POST', '/api/events', { kind: 'counter', day: '2026-09-03', counter_id: b.cnt.id, counter_value: 1 });
  await denied('заметка в папку Б', tokenA, 'POST', '/api/notes', { kind: 'note', title: 'чужой ребёнок', parent_id: b.folder.id });
  await denied('перенос своей заметки в папку Б', tokenA, 'PUT', `/api/notes/${a.note.id}`, { parent_id: b.folder.id });
  await denied('файл к заметке Б', tokenA, 'POST', `/api/files?note_id=${b.note.id}&name=x.txt`, undefined);
  // смена порядка чужих занятий отвечает «ок», но не должна ничего менять
  await api(tokenA, 'PUT', '/api/activities/order', { ids: [b.act.id] });
  const bAct = await db.withUser(idB, (qq) => qq.query('SELECT position FROM activities WHERE id=$1 AND user_id=$2', [b.act.id, idB]));
  if (bAct.rows.length && bAct.rows[0].position === b.act.position) ok('порядок занятий Б не тронут');
  else fail('порядок занятий Б', `position стал ${bAct.rows[0] && bAct.rows[0].position} вместо ${b.act.position}`);

  console.log('\n4. Пакетное сохранение с чужими идентификаторами');
  // пакетное сохранение чужую запись просто пропускает: в ответе не должно быть событий
  const batch = await api(tokenA, 'POST', '/api/events/batch', { upsert: [{ id: b.ev.id, kind: 'activity', day: '2026-09-01', hours: [9], text: 'взлом' }] });
  if (batch.status === 200 && Array.isArray(batch.data.events) && batch.data.events.length === 0) ok('batch с чужим id вернул пустой список');
  else fail('batch с чужим id', `${batch.status} ${JSON.stringify(batch.data).slice(0, 120)}`);
  const bEv = await db.withUser(idB, (qq) => qq.query('SELECT text FROM events WHERE id=$1 AND user_id=$2', [b.ev.id, idB]));
  if (bEv.rows[0] && bEv.rows[0].text === 'секрет Б') ok('batch не изменил событие Б');
  else fail('batch', `текст события Б стал «${bEv.rows[0] && bEv.rows[0].text}»`);
  const delRes = await api(tokenA, 'POST', '/api/events/batch', { delete: [b.ev.id, b.task.id] });
  const bLeft = await db.withUser(idB, (qq) => qq.query('SELECT count(*)::int n FROM events WHERE user_id=$1', [idB]));
  if (bLeft.rows[0].n === 2) ok(`batch-удаление чужих событий ничего не удалило (${delRes.status})`);
  else fail('batch-удаление', `у Б осталось событий: ${bLeft.rows[0].n} вместо 2`);

  console.log('\n5. Уровень базы: политики RLS');
  const noCtx = await db.query('SELECT count(*)::int n FROM events');
  if (noCtx.rows[0].n === 0) ok('без контекста пользователя таблица events пуста');
  else fail('RLS без контекста', `видно строк: ${noCtx.rows[0].n}`);
  const wideOpen = await db.withUser(idA, (qq) => qq.query('SELECT count(*)::int n FROM events', [], { unscoped: true }));
  if (wideOpen.rows[0].n === 2) ok('запрос без WHERE от имени А вернул только его 2 события');
  else fail('RLS с контекстом', `вернулось строк: ${wideOpen.rows[0].n} вместо 2`);
  try {
    await db.withUser(idA, (qq) => qq.query('INSERT INTO events(user_id, kind, day, position) VALUES ($1, $2, $3, 0)', [idB, 'activity', '2026-09-05']));
    fail('RLS на запись', 'удалось вставить строку с чужим user_id');
  } catch (e) {
    if (/row-level security/i.test(e.message)) ok('вставка строки с чужим user_id отбита политикой');
    else fail('RLS на запись', e.message);
  }
  try {
    await db.withUser(idA, (qq) => qq.query('SELECT id FROM events LIMIT 1'));
    fail('обёртка запросов', 'запрос без user_id прошёл');
  } catch (e) {
    if (/без user_id/.test(e.message)) ok('обёртка не пустила запрос без user_id');
    else fail('обёртка запросов', e.message);
  }

  console.log('\n6. Токен и сессии');
  const bad = await fetch(BASE + '/api/bootstrap', { headers: { Authorization: 'Bearer poddelka-1234567890' } });
  if (bad.status === 401) ok('поддельный токен → 401'); else fail('поддельный токен', `статус ${bad.status}`);
  const meA = (await api(tokenA, 'GET', '/api/me')).data;
  if (JSON.stringify(meA).includes(LOGIN_B)) fail('профиль А', 'виден логин Б'); else ok('профиль А без данных Б');

  // уборка: удаляем тестовые аккаунты вместе с данными и файлами
  await db.txAdmin(async (c) => {
    for (const id of [idA, idB]) await c.query('DELETE FROM users WHERE id = $1', [id]);
  });
  console.log('\nТестовые аккаунты удалены.');

  console.log(`\nПроверок пройдено: ${passed}, провалено: ${failures.length}`);
  if (failures.length) {
    console.log('\nПровалы:');
    for (const f of failures) console.log('  - ' + f);
    process.exit(1);
  }
  console.log('Изоляция данных подтверждена.');
  process.exit(0);
}

main().catch((e) => { console.error('Тест не смог доработать до конца:', e.message || e); process.exit(2); });
