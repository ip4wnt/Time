#!/usr/bin/env bash
# Установка ХРОНУМ на чистый Ubuntu 22.04/24.04 VPS.
# С доменом и HTTPS:  sudo DOMAIN=time.example.com EMAIL=you@example.com bash deploy/install.sh
# Без домена (по IP, http): sudo bash deploy/install.sh
# Скрипт идемпотентный — можно запускать повторно (обновление кода: git pull && systemctl restart chronum).
set -euo pipefail

DOMAIN="${DOMAIN:-}"                # пусто — работаем по IP без HTTPS
EMAIL="${EMAIL:-}"                  # нужен только вместе с DOMAIN
if [[ -n "$DOMAIN" && -z "$EMAIL" ]]; then echo "С DOMAIN нужно указать EMAIL=почта для сертификата"; exit 1; fi

# Для корневого домена берём сертификат и на www. Отключить: WWW=0
WWW="${WWW:-1}"
SERVER_NAMES="$DOMAIN"
CERT_ARGS="-d $DOMAIN"
if [[ -n "$DOMAIN" && "$WWW" == "1" && "$(grep -o '\.' <<<"$DOMAIN" | wc -l)" == "1" ]]; then
  SERVER_NAMES="$DOMAIN www.$DOMAIN"
  CERT_ARGS="-d $DOMAIN -d www.$DOMAIN"
fi
REPO="${REPO:-https://github.com/ip4wnt/Time.git}"
BRANCH="${BRANCH:-v2}"
APP_DIR=/opt/chronum
DATA_DIR=/var/lib/chronum
ENV_DIR=/etc/chronum
# Без `tr | head`: head закрывает канал, tr получает SIGPIPE и pipefail роняет скрипт молча.
gen_pass() { openssl rand -hex 24 2>/dev/null || date +%s%N | sha256sum | cut -c1-48; }
DB_PASS="${DB_PASS:-$(gen_pass)}"

echo "== пакеты"
apt-get update -q
PKGS="ca-certificates curl git nginx postgresql postgresql-contrib"
[[ -n "$DOMAIN" ]] && PKGS="$PKGS certbot python3-certbot-nginx"
apt-get install -y -q $PKGS

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
# Каталог принадлежит chronum, а скрипт идёт от root — без этого git ругается
# на dubious ownership и установка падает.
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
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
# Без HTTPS cookie с флагом Secure не доедет до браузера, с HTTPS — обязателен.
# Переставляем всегда, включая повторный запуск на уже готовой машине.
sed -i "s#^SECURE_COOKIES=.*#SECURE_COOKIES=$([[ -n "$DOMAIN" ]] && echo 1 || echo 0)#" "$ENV_DIR/.env"

echo "== схема БД"
sudo -u chronum env CHRONUM_ENV="$ENV_DIR/.env" node -e "require('./server/db').migrate().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)})"

echo "== systemd"
install -m 644 deploy/chronum.service /etc/systemd/system/chronum.service
systemctl daemon-reload
systemctl enable -q --now chronum
systemctl restart chronum

echo "== nginx"
rm -f /etc/nginx/sites-enabled/default
if [[ -z "$DOMAIN" ]]; then
  install -m 644 deploy/nginx-http.conf /etc/nginx/sites-available/chronum
  ln -sf /etc/nginx/sites-available/chronum /etc/nginx/sites-enabled/chronum
  nginx -t && systemctl reload nginx
  URL="http://$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
else
  # шаг 1: временный http-конфиг, чтобы прошла ACME-проверка
  sed "s#server_name _;#server_name $SERVER_NAMES;#" deploy/nginx-http.conf > /etc/nginx/sites-available/chronum
  ln -sf /etc/nginx/sites-available/chronum /etc/nginx/sites-enabled/chronum
  mkdir -p /var/www/html
  nginx -t && systemctl reload nginx
  # шаг 2: сертификат
  certbot certonly --webroot -w /var/www/html $CERT_ARGS -m "$EMAIL" --agree-tos --non-interactive --keep-until-expiring
  # шаг 3: боевой конфиг с HTTPS
  sed -e "s#__SERVER_NAMES__#$SERVER_NAMES#g" \
      -e "s#__CERT_DOMAIN__#$DOMAIN#g" \
      -e "s@# ssl_certificate @ssl_certificate @" \
      -e "s@# ssl_certificate_key @ssl_certificate_key @" \
      -e "s@# include @include @" \
      -e "s@# ssl_dhparam @ssl_dhparam @" deploy/nginx.conf > /etc/nginx/sites-available/chronum
  [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]] || sed -i '/options-ssl-nginx.conf/d' /etc/nginx/sites-available/chronum
  [[ -f /etc/letsencrypt/ssl-dhparams.pem ]] || sed -i '/ssl-dhparams.pem/d' /etc/nginx/sites-available/chronum
  nginx -t && systemctl reload nginx
  systemctl enable -q certbot.timer 2>/dev/null || true
  URL="https://$DOMAIN"
fi

echo
echo "Готово: $URL"
[[ -n "$DOMAIN" ]] || echo "ВНИМАНИЕ: сейчас без HTTPS. Появится домен — перезапустите: sudo DOMAIN=ваш.домен EMAIL=почта bash deploy/install.sh"
echo "Создать пользователя:  cd $APP_DIR && sudo -u chronum env CHRONUM_ENV=$ENV_DIR/.env node scripts/create-user.js \"Логин\" \"Пароль\""
echo "Сменить пароль:        cd $APP_DIR && sudo -u chronum env CHRONUM_ENV=$ENV_DIR/.env node scripts/set-password.js \"Логин\" \"Пароль\""
echo "Импорт старой выгрузки: sudo -u chronum env CHRONUM_ENV=$ENV_DIR/.env node scripts/import-legacy.js \"Логин\" /путь/backup.json"
echo "Логи: journalctl -u chronum -f"
