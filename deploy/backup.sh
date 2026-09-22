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
say "== база $DB_NAME"
DB_URL=""
if [[ -r "$ENV_FILE" ]]; then
  DB_URL="$(sed -n 's/^[[:space:]]*DATABASE_URL[[:space:]]*=[[:space:]]*//p' "$ENV_FILE" | tail -1 | tr -d '"'"'"'')"
fi
if [[ -n "$DB_URL" ]]; then
  pg_dump -Fc "$DB_URL" > "$DEST/db.dump"
elif [[ $EUID -eq 0 ]] && id -u postgres >/dev/null 2>&1; then
  sudo -u postgres pg_dump -Fc "$DB_NAME" > "$DEST/db.dump"
else
  say "Не удалось определить подключение к базе: нет доступа к $ENV_FILE и нет прав postgres."
  say "Запустите через sudo или задайте ENV_FILE=/путь/.env"
  exit 1
fi
# дамп должен читаться — иначе это не бэкап
pg_restore -l "$DEST/db.dump" > /dev/null
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
