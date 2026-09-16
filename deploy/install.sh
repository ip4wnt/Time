#!/usr/bin/env bash
# Установка ХРОНУМ на чистый Ubuntu 22.04/24.04 VPS.
# Запуск от root:  DOMAIN=time.example.com EMAIL=you@example.com bash deploy/install.sh
# Скрипт идемпотентный — можно запускать повторно (обновление кода: git pull && systemctl restart chronum).
set -euo pipefail

DOMAIN="${DOMAIN:?Укажите DOMAIN=ваш.домен}"
EMAIL="${EMAIL:?Укажите EMAIL=почта для Lets Encrypt}"
REPO="${REPO:-https://github.com/ip4wnt/Time.git}"
BRANCH="${BRANCH:-v2}"
APP_DIR=/opt/chronum
DATA_DIR=/var/lib/chronum
ENV_DIR=/etc/chronum
DB_PASS="${DB_PASS:-$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)}"

echo "== пакеты"
apt-get update -q
apt-get install -y -q ca-certificates curl git nginx postgresql postgresql-contrib certbot python3-certbot-nginx

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 20 ]]; then
  echo "== Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -q nodejs
fi

echo "== пользователь и каталоги"
id -u chronum >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin chronum
mkdir -p "$DATA_DIR/uploads" "$ENV_DIR"
chown -R chronum:chronum "$DATA_DIR"

echo "== код"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH" && git -C "$APP_DIR" checkout -q "$BRANCH" && git -C "$APP_DIR" pull -q
else
  git clone -q --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund 2>/dev/null || npm install --omit=dev --no-audit --no-fund
chown -R chronum:chronum "$APP_DIR"

echo "== PostgreSQL"
systemctl enable -q --now postgresql
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='chronum'" | grep -q 1; then
  sudo -u postgres psql -qc "CREATE ROLE chronum LOGIN PASSWORD '$DB_PASS';"
  sudo -u postgres psql -qc "CREATE DATABASE chronum OWNER chronum ENCODING 'UTF8';"
  echo "   создана БД chronum, пароль: $DB_PASS"
fi

echo "== конфигурация"
if [[ ! -f "$ENV_DIR/.env" ]]; then
  sed -e "s#СМЕНИТЬ_ПАРОЛЬ#$DB_PASS#" -e "s#^UPLOAD_DIR=.*#UPLOAD_DIR=$DATA_DIR/uploads#" deploy/.env.example > "$ENV_DIR/.env"
  chmod 640 "$ENV_DIR/.env"; chown root:chronum "$ENV_DIR/.env"
fi

echo "== схема БД"
sudo -u chronum CHRONUM_ENV="$ENV_DIR/.env" node -e "require('./server/db').migrate().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"

echo "== systemd"
install -m 644 deploy/chronum.service /etc/systemd/system/chronum.service
systemctl daemon-reload
systemctl enable -q --now chronum
systemctl restart chronum

echo "== nginx + Let's Encrypt"
sed "s#example.com#$DOMAIN#g" deploy/nginx.conf > /etc/nginx/sites-available/chronum
ln -sf /etc/nginx/sites-available/chronum /etc/nginx/sites-enabled/chronum
rm -f /etc/nginx/sites-enabled/default
# до получения сертификата временно отключаем 443-блок
if [[ ! -d /etc/letsencrypt/live/$DOMAIN ]]; then
  awk 'BEGIN{skip=0} /listen 443/{skip=1} skip==0{print} /^}/{if(skip==1){skip=0}}' /etc/nginx/sites-available/chronum > /tmp/chronum-http.conf
  # первый блок (80) без редиректа, чтобы прошла ACME-проверка
  sed -i 's#return 301 https://\$host\$request_uri;#proxy_pass http://127.0.0.1:3000;#' /tmp/chronum-http.conf
  cp /tmp/chronum-http.conf /etc/nginx/sites-enabled/chronum
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect
  ln -sf /etc/nginx/sites-available/chronum /etc/nginx/sites-enabled/chronum
  certbot --nginx -d "$DOMAIN" --non-interactive --reinstall >/dev/null 2>&1 || true
fi
nginx -t && systemctl reload nginx
systemctl enable -q certbot.timer 2>/dev/null || true

echo
echo "Готово: https://$DOMAIN"
echo "Создать пользователя:  cd $APP_DIR && sudo -u chronum CHRONUM_ENV=$ENV_DIR/.env node scripts/create-user.js \"Логин\" \"Вопрос 1\" \"Ответ 1\" \"Вопрос 2\" \"Ответ 2\""
echo "Импорт старой выгрузки: sudo -u chronum CHRONUM_ENV=$ENV_DIR/.env node scripts/import-legacy.js \"Логин\" /путь/backup.json"
echo "Логи: journalctl -u chronum -f"
