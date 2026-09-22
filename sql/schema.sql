-- ХРОНУМ — схема базы данных (PostgreSQL 14+)
-- Применяется автоматически при старте сервера (server/db.js), идемпотентна.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  login         TEXT NOT NULL,
  login_norm    TEXT NOT NULL UNIQUE,          -- нижний регистр, без лишних пробелов
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  settings      JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Пароль хранится только в виде хэша (scrypt + соль), формат: scrypt$<salt hex>$<hash hex>
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Запрос на удаление аккаунта: через 30 дней данные удаляются, вход до срока отменяет удаление
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_requested_at TIMESTAMPTZ;

-- Контрольные вопросы: не используются с переходом на вход по паролю, таблица оставлена для старых данных
CREATE TABLE IF NOT EXISTS security_questions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL DEFAULT 0,
  question    TEXT NOT NULL,
  answer_hash TEXT NOT NULL,                    -- формат: scrypt$<salt hex>$<hash hex>
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_questions_user_idx ON security_questions(user_id);

-- Сессии (токен хранится только как SHA-256 хэш)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Незавершённые попытки входа (login -> два вопроса) и журнал попыток
CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGSERIAL PRIMARY KEY,
  login_norm  TEXT,
  ip          TEXT,
  ok          BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts(ip, created_at);

-- Занятия (категории с цветом)
CREATE TABLE IF NOT EXISTS activities (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,                     -- #RRGGBB
  position   INT NOT NULL DEFAULT 0,
  is_sleep   BOOLEAN NOT NULL DEFAULT false,    -- сон не учитывается в доминанте дня
  archived   BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_user_idx ON activities(user_id, position);

-- Теги к занятию (работа -> фонд, юрист, деревья)
CREATE TABLE IF NOT EXISTS tags (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_id BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tags_activity_idx ON tags(activity_id, position);

-- Счётчики (упорядочены; верхний — «текущий», показывается на ячейках)
CREATE TABLE IF NOT EXISTS counters (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT '',
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS counters_user_idx ON counters(user_id, position);

-- События: занятие / задача / еда / мысль / показание счётчика.
-- Занятие, еда, мысль, счётчик привязаны к дню и набору часов (hours).
-- Задача привязана к набору дней (days), hours = NULL.
CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('activity','task','food','thought','counter')),
  day           DATE NOT NULL,                  -- якорный день (для задач — первый из days)
  hours         SMALLINT[],                     -- часы 0..23 (NULL для задач)
  days          DATE[],                         -- дни задачи (NULL для остальных)
  position      INT NOT NULL DEFAULT 0,         -- порядок внутри часа: 0 — основное, красит ячейку
  activity_id   BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  tag_id        BIGINT REFERENCES tags(id) ON DELETE SET NULL,
  text          TEXT NOT NULL DEFAULT '',
  mood          TEXT CHECK (mood IN ('sad','neutral','happy')),
  kcal          NUMERIC(8,1),
  protein       NUMERIC(8,1),
  fat           NUMERIC(8,1),
  carbs         NUMERIC(8,1),
  food_calc     JSONB,                          -- разбор по продуктам
  counter_id    BIGINT REFERENCES counters(id) ON DELETE CASCADE,
  counter_value NUMERIC(12,2),
  done          BOOLEAN NOT NULL DEFAULT false,
  done_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv           TSVECTOR GENERATED ALWAYS AS (to_tsvector('russian', coalesce(text,''))) STORED
);
CREATE INDEX IF NOT EXISTS events_user_day_idx ON events(user_id, day);
CREATE INDEX IF NOT EXISTS events_user_kind_idx ON events(user_id, kind, day);
CREATE INDEX IF NOT EXISTS events_days_gin ON events USING GIN (days);
CREATE INDEX IF NOT EXISTS events_tsv_gin ON events USING GIN (tsv);

-- Важные даты (звёздочка на календаре)
CREATE TABLE IF NOT EXISTS important_dates (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  yearly     BOOLEAN NOT NULL DEFAULT false,    -- повторять каждый год
  title      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv        TSVECTOR GENERATED ALWAYS AS (to_tsvector('russian', coalesce(title,''))) STORED
);
CREATE INDEX IF NOT EXISTS important_dates_user_idx ON important_dates(user_id, day);

-- Заметки: дерево папок и заметок произвольной вложенности
CREATE TABLE IF NOT EXISTS notes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  BIGINT REFERENCES notes(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('folder','note')),
  title      TEXT NOT NULL DEFAULT '',
  icon       TEXT NOT NULL DEFAULT '',          -- имя значка для папок
  content    TEXT NOT NULL DEFAULT '',
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv        TSVECTOR GENERATED ALWAYS AS (
               setweight(to_tsvector('russian', coalesce(title,'')), 'A') ||
               setweight(to_tsvector('russian', coalesce(content,'')), 'B')) STORED
);
CREATE INDEX IF NOT EXISTS notes_user_parent_idx ON notes(user_id, parent_id, position);
CREATE INDEX IF NOT EXISTS notes_tsv_gin ON notes USING GIN (tsv);

-- История версий заметки для отмены (хранится 30 минут)
CREATE TABLE IF NOT EXISTS note_revisions (
  id         BIGSERIAL PRIMARY KEY,
  note_id    BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_revisions_note_idx ON note_revisions(note_id, created_at);

-- Файлы (картинки, аудио, документы) — на диске, здесь метаданные
CREATE TABLE IF NOT EXISTS files (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id      BIGINT REFERENCES notes(id) ON DELETE CASCADE,
  event_id     BIGINT REFERENCES events(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL DEFAULT 'application/octet-stream',
  size         BIGINT NOT NULL DEFAULT 0,
  storage_key  TEXT NOT NULL UNIQUE,            -- относительный путь в каталоге UPLOAD_DIR
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_note_idx ON files(note_id);
CREATE INDEX IF NOT EXISTS files_event_idx ON files(event_id);

-- ===== Изоляция данных пользователей на уровне базы (Row Level Security) =====
-- Приложение открывает транзакцию и выставляет chronum.user_id (см. db.withUser).
-- После этого строки других пользователей не видны и не записываются — даже если
-- в запросе забыли условие WHERE user_id. Служебные задачи (регистрация, импорт,
-- очистка) работают в транзакции с chronum.admin='on' (см. db.txAdmin).
-- FORCE нужен потому, что владелец таблиц иначе политики обходит.
DO $rls$
DECLARE
  t     text;
  cond  text := $c$(
    user_id = nullif(current_setting('chronum.user_id', true), '')::bigint
    OR current_setting('chronum.admin', true) = 'on'
  )$c$;
BEGIN
  FOREACH t IN ARRAY ARRAY['activities', 'tags', 'counters', 'events', 'important_dates', 'notes', 'files'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own', t);
    EXECUTE format('CREATE POLICY %I ON %I USING %s WITH CHECK %s', t || '_own', t, cond, cond);
  END LOOP;
END
$rls$;
