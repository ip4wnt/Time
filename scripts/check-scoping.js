#!/usr/bin/env node
'use strict';
// Статическая проверка: нет ли в коде запросов к защищённым таблицам без фильтра по user_id.
// RLS такие запросы всё равно не пропустит, но забытое условие — признак ошибки,
// и найти её лучше до деплоя. Запуск: node scripts/check-scoping.js
const fs = require('node:fs');
const path = require('node:path');
const { PROTECTED_TABLES } = require('../server/db');

const TOUCHES = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+(?:${PROTECTED_TABLES.join('|')})\\b`, 'i');
const SQL_START = /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE)\b/i;
const dir = path.join(__dirname, '..', 'server');

const problems = [];
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const lines = text.split('\n');
  // строковые литералы: '...', "...", `...` (в т.ч. многострочные шаблоны)
  const re = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0].slice(1, -1);
    if (!SQL_START.test(raw) || !TOUCHES.test(raw)) continue;
    if (/user_id/i.test(raw)) continue;
    const line = lines.length && text.slice(0, m.index).split('\n').length;
    problems.push({ file, line, sql: raw.replace(/\s+/g, ' ').trim().slice(0, 140) });
  }
}

if (!problems.length) {
  console.log('Проверка пройдена: все запросы к защищённым таблицам фильтруют по user_id.');
  process.exit(0);
}
console.error(`Найдено запросов без user_id: ${problems.length}`);
for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.sql}`);
console.error('Добавьте условие по user_id или, если оно осознанно не нужно, вызовите query(..., { unscoped: true }).');
process.exit(1);
