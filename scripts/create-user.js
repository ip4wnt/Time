#!/usr/bin/env node
'use strict';
// Создание пользователя из консоли (без веб-регистрации).
// Использование: node scripts/create-user.js "Логин" "Пароль"
const auth = require('../server/auth');
const db = require('../server/db');

async function main() {
  const [login, password] = process.argv.slice(2);
  if (!login || !password) {
    console.error('Использование: node scripts/create-user.js "Логин" "Пароль"');
    process.exit(1);
  }
  await db.migrate();
  const id = await auth.createUser(login, password);
  console.log(`Пользователь «${login}» создан, id=${id}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
