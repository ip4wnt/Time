#!/usr/bin/env bash
# Ручной бэкап ХРОНУМ: база, загруженные файлы, конфиг — одной командой.
#
#   sudo bash /opt/chronum/deploy/backup.sh
#
# Кладёт всё в ~/chronum-backups/ГГГГ-ММ-ДД_ЧЧММ/ и оставляет последние KEEP копий.
# Переменные (все необязательные):
#   OUT_DIR=/куда/класть   DB_NAME=chronum   UPLOAD_DIR=/var/lib/chronum/uploads
#   ENV_FILE=/etc/chronum/.env   KEEP=5   (0 — не удалять старые)
set -euo pipefail

DB_NAME="${DB_NAME:-chronum}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/chronum/uploads}"
ENV_FILE="${ENV_FILE:-/etc/chronum/.env}"
KEEP="${KEEP:-5}"

# По умолчанию — домашний каталог того, кто вызвал sudo, а не root
HOME_DIR="$HOME"
if [[ -n "${SUDO_USER:-}" ]]; then
  HOME_DIR="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
fi
OUT_DIR="${OUT_DIR:-$HOME_DIR/chronum-backups}"

STAMP="$(date +%F_%H%M)"
DEST="$OUT_DIR/$STAMP"
mkdir -p "$DEST"

say() { printf '%s\n' "$*"; }
size() { du -h "$1" 2>/dev/null | cut -f1; }

# ---- 1. база ----
# Снимаем дамп от суперпользователя postgres: таблицы закрыты политиками RLS
# (FORCE ROW LEVEL SECURITY), и pg_dump от имени роли приложения вернёт ошибку.
say "== база $DB_NAME"
DB_URL=""
if [[ -r "$ENV_FILE" ]]; then
  DB_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -1 | tr -d '"'"'"'')"
fi
SU_PSQL=""
if [[ $EUID -eq 0 ]] && id -u postgres >/dev/null 2>&1; then
  sudo -u postgres pg_dump -Fc "$DB_NAME" > "$DEST/db.dump"
  SU_PSQL="sudo -u postgres psql -d $DB_NAME"
elif [[ -n "$DB_URL" ]]; then
  say "   postgres недоступен, пробую подключение из $ENV_FILE"
  if ! pg_dump -Fc "$DB_URL" > "$DEST/db.dump" 2> "$DEST/pg_dump.err"; then
    say "Дамп не удался:"
    sed 's/^/   /' "$DEST/pg_dump.err"
    say "Скорее всего это RLS: роль приложения не может читать закрытые таблицы целиком."
    say "Запустите скрипт через sudo, чтобы дамп снимался от имени postgres."
    exit 1
  fi
  rm -f "$DEST/pg_dump.err"
else
  say "Не удалось определить подключение к базе: нет прав postgres и нет доступа к $ENV_FILE."
  say "Запустите через sudo или задайте ENV_FILE=/путь/.env"
  exit 1
fi
# дамп должен читаться — иначе это не бэкап
pg_restore -l "$DEST/db.dump" > /dev/null
# и в нём должны быть данные всех закрытых политиками таблиц, а не пустые секции
MISSING=""
for t in activities tags counters events important_dates notes files; do
  pg_restore -l "$DEST/db.dump" | grep -q "TABLE DATA public $t " || MISSING="$MISSING $t"
done
if [[ -n "$MISSING" ]]; then
  say "В дампе нет данных таблиц:$MISSING — это неполный бэкап, разбирайтесь до того, как он понадобится."
  exit 1
fi
# контрольное сравнение числа записей: в живой базе и в дампе
if [[ -n "$SU_PSQL" ]]; then
  LIVE="$($SU_PSQL -Atc 'SELECT count(*) FROM events' 2>/dev/null || echo '')"
  # читаем дамп от текущего пользователя (root): файл лежит в домашнем каталоге,
  # куда у postgres обычно нет доступа, а подключение к базе для этого не нужно
  INDUMP="$(pg_restore --data-only --table=events -f - "$DEST/db.dump" 2> "$DEST/pg_restore.err" | grep -c '^[0-9]' || true)"
  if [[ -n "$LIVE" && "$LIVE" != "$INDUMP" ]]; then
    say "Записей в базе — $LIVE, в дампе — $INDUMP."
    [[ -s "$DEST/pg_restore.err" ]] && sed 's/^/   /' "$DEST/pg_restore.err"
    say "Проверьте права на файл дампа и политики; сама копия лежит в $DEST"
    exit 1
  fi
  rm -f "$DEST/pg_restore.err"
  [[ -n "$LIVE" ]] && say "   записей events: $LIVE — совпадает с дампом"
fi
say "   db.dump — $(size "$DEST/db.dump")"

# ---- 2. файлы ----
if [[ -d "$UPLOAD_DIR" ]]; then
  say "== файлы $UPLOAD_DIR"
  tar czf "$DEST/uploads.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  say "   uploads.tar.gz — $(size "$DEST/uploads.tar.gz")"
else
  say "== файлы: каталога $UPLOAD_DIR нет, пропускаю"
fi

# ---- 3. конфиг ----
if [[ -r "$ENV_FILE" ]]; then
  say "== конфиг $ENV_FILE"
  cp "$ENV_FILE" "$DEST/env"
  chmod 600 "$DEST/env"
else
  say "== конфиг: $ENV_FILE недоступен, пропускаю (запустите через sudo)"
fi

# ---- контрольные суммы и владелец ----
( cd "$DEST" && sha256sum db.dump uploads.tar.gz env 2>/dev/null > sha256.txt || true )
if [[ -n "${SUDO_USER:-}" ]]; then
  chown -R "$SUDO_USER":"$(id -gn "$SUDO_USER")" "$OUT_DIR"
fi

# ---- ротация ----
if [[ "$KEEP" -gt 0 ]]; then
  mapfile -t OLD < <(ls -1d "$OUT_DIR"/*/ 2>/dev/null | sort | head -n -"$KEEP")
  for d in "${OLD[@]:-}"; do
    [[ -n "$d" ]] || continue
    rm -rf "$d"
    say "== удалена старая копия $(basename "$d")"
  done
fi

say ""
say "Готово: $DEST ($(size "$DEST") всего)"
say "Забрать к себе: scp -r $(whoami)@СЕРВЕР:$DEST ."
say "Восстановление: см. deploy/RESTORE.md"
