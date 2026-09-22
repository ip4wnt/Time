# ХРОНУМ

Личный трекер времени: занятия по часам, задачи, еда с расчётом КБЖУ, мысли, счётчики, даты, заметки с файлами и поиск по всему.

Стек: Node.js 20 (только встроенные модули + `pg`), PostgreSQL, vanilla JS без сборки.

## Структура

```
server/     HTTP-сервер, авторизация, REST API, расчёт КБЖУ
sql/        schema.sql — схема БД (применяется автоматически при старте)
public/     фронтенд (SPA на hash-маршрутах)
scripts/    create-user.js, import-legacy.js (перенос выгрузки из старой версии)
deploy/     systemd-юнит, nginx, install.sh, .env.example
legacy/     старая offline-версия (localStorage)
```

## Локальный запуск

```bash
createdb chronum            # PostgreSQL должен быть установлен
cp deploy/.env.example .env # поправить DATABASE_URL, поставить SECURE_COOKIES=0
npm install
npm start                   # http://localhost:3000
```

Создать пользователя вручную (иначе — регистрация в интерфейсе):

```bash
node scripts/create-user.js "Логин" "Вопрос 1" "Ответ 1" "Вопрос 2" "Ответ 2"
node scripts/import-legacy.js "Логин" backup.json   # выгрузка из старой версии
```

## Установка на VPS (Ubuntu)

```bash
git clone -b v2 https://github.com/ip4wnt/Time.git && cd Time

# с доменом и HTTPS (Let's Encrypt)
sudo DOMAIN=time.example.com EMAIL=you@example.com bash deploy/install.sh

# или пока без домена — по IP на 80-м порту, без HTTPS
sudo bash deploy/install.sh
```

Когда домен появится, просто перезапустите скрипт с `DOMAIN` и `EMAIL` — он получит сертификат и переключит nginx на HTTPS.

Скрипт ставит Node 20, PostgreSQL, nginx, certbot; создаёт БД и пользователя ОС `chronum`, раскладывает код в `/opt/chronum`, конфиг в `/etc/chronum/.env`, файлы в `/var/lib/chronum/uploads`, запускает сервис `chronum` и получает сертификат Let's Encrypt.

Обновление: `cd /opt/chronum && sudo git pull && sudo systemctl restart chronum`.

## Авторизация

Вход по логину и паролю. Пароль хранится только в виде хэша (scrypt с солью), минимальная длина — шесть знаков. Сессия — случайный токен на 30 дней; попытки входа ограничены по IP. Сменить пароль можно в разделе «профиль» или командой `scripts/set-password.js`.

## Данные

Каждая запись привязана к `user_id`, все запросы фильтруются по владельцу сессии. Текст хранится в открытом виде, чтобы работал полнотекстовый поиск PostgreSQL (`tsvector`, русская морфология). Файлы лежат на диске, в БД — метаданные. Защита канала — HTTPS через nginx.
