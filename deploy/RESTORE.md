# Восстановление ХРОНУМ из бэкапа

Бэкап делается скриптом `deploy/backup.sh` и содержит три файла:

| Файл | Что внутри |
|---|---|
| `db.dump` | база `chronum` в формате `pg_dump -Fc` |
| `uploads.tar.gz` | каталог `uploads` с фото, аудио и вложениями |
| `env` | копия `/etc/chronum/.env` (там пароль базы) |

## Полное восстановление

```bash
sudo systemctl stop chronum

# конфиг — если сервер новый
sudo install -m 640 -o root -g chronum env /etc/chronum/.env

# база
sudo -u postgres dropdb --if-exists chronum
sudo -u postgres createdb chronum -O chronum
sudo -u postgres pg_restore -d chronum db.dump

# файлы
sudo tar xzf uploads.tar.gz -C /var/lib/chronum
sudo chown -R chronum:chronum /var/lib/chronum/uploads

sudo systemctl start chronum
sudo systemctl status chronum --no-pager
```

Если база уже есть и нужно просто перезаписать её содержимое, без `dropdb`:

```bash
sudo -u postgres pg_restore -c -d chronum db.dump
```

## Частичные операции

```bash
pg_restore -l db.dump                                   # что внутри дампа
sudo -u postgres pg_restore -d chronum -t events db.dump # только одна таблица
sha256sum -c sha256.txt                                 # проверить целостность копии
```

## Если пароль базы из `env` не совпадает с тем, что в PostgreSQL

Задать роли пароль из бэкапа (значение берётся из `DATABASE_URL` в файле `env`):

```bash
sudo -u postgres psql -qc "ALTER ROLE chronum PASSWORD 'пароль_из_env';"
```

## Почему всё через `sudo -u postgres`

Таблицы с данными закрыты политиками RLS в режиме `FORCE ROW LEVEL SECURITY`, поэтому роль
приложения `chronum` не может ни выгрузить, ни залить их целиком: `pg_dump` и `pg_restore`
от её имени завершатся ошибкой «query would be affected by row-level security policy».
Бэкап и восстановление делаются от суперпользователя `postgres` — политики его не касаются.
Скрипт `backup.sh` это учитывает сам и дополнительно сверяет число записей в базе и в дампе.

Схема при старте сервера подтягивается сама (`server/db.js` применяет `sql/schema.sql`), так что после восстановления дополнительных миграций не нужно.
