#!/usr/bin/env node
'use strict';
// Создание пользователя из консоли (без веб-регистрации).
// Использование: node scripts/create-user.js "Логин" "Вопрос 1" "Ответ 1" "Вопрос 2" "Ответ 2"
const auth = require('../server/auth');
const db = require('../server/db');

async function main() {
  const [login, q1, a1, q2, a2] = process.argv.slice(2);
  if (!login || !q1 || !a1 || !q2 || !a2) {
    console.error('Использование: node scripts/create-user.js "Логин" "Вопрос 1" "Ответ 1" "Вопрос 2" "Ответ 2"');
    process.exit(1);
  }
  await db.migrate();
  const id = await auth.createUser(login, [{ question: q1, answer: a1 }, { question: q2, answer: a2 }]);
  console.log(`Пользователь «${login}» создан, id=${id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
