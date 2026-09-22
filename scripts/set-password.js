#!/usr/bin/env node
'use strict';
// Установка или смена пароля существующему пользователю.
// Использование: node scripts/set-password.js "Логин" "Новый пароль"
const auth = require('../server/auth');
const db = require('../server/db');

async function main() {
  const [login, password] = process.argv.slice(2);
  if (!login || !password) {
    console.error('Использование: node scripts/set-password.js "Логин" "Новый пароль"');
    process.exit(1);
  }
  await db.migrate();
  const id = await auth.setPassword(login, password);
  console.log(`Пароль пользователя «${login}» (id=${id}) обновлён`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
