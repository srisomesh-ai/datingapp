#!/usr/bin/env bash
# One-command install / update of the app on a fresh Ubuntu 22.04 or 24.04 VPS.
#
#   First install:  sudo bash setup.sh --admin-email you@example.com
#   Update later:   sudo bash /opt/datingapp/deploy/setup.sh
#
# Without --domain it uses a free hostname that points at this server's IP
# (e.g. 203-0-113-7.sslip.io), so HTTPS (needed for camera/mic) works before you
# buy a domain. Re-run with --domain yourapp.com once the domain points here.
#
# Options:
#   --admin-email EMAIL        account that becomes admin when it signs up
#   --domain NAME              hostname to serve (default: <ip>.sslip.io)
#   --razorpay-key-id ID       Razorpay key id (test or live)
#   --razorpay-key-secret KEY  Razorpay key secret
#   --branch NAME              git branch to deploy (default: main)
#   --repo URL                 git repository (default: this project on GitHub)
set -euo pipefail

APP=datingapp
APP_DIR=/opt/$APP
DATA_DIR=/var/lib/$APP
BACKUP_DIR=/var/backups/$APP
ENV_FILE=/etc/$APP.env
PORT=4000

log() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root: sudo bash $0 ..."
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || die "this script supports Ubuntu 22.04 / 24.04 (found ${PRETTY_NAME:-unknown})"

# Values from a previous run are kept unless overridden.
env_get() { [[ -f $ENV_FILE ]] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 || true; }
ADMIN_EMAIL=$(env_get ADMIN_EMAILS)
DOMAIN=$(env_get DOMAIN)
RZP_ID=$(env_get RAZORPAY_KEY_ID)
RZP_SECRET=$(env_get RAZORPAY_KEY_SECRET)
JWT_SECRET=$(env_get JWT_SECRET)
TURN_SECRET=$(env_get TURN_SECRET)
BRANCH=$(env_get DEPLOY_BRANCH)
REPO=$(env_get DEPLOY_REPO)

while [[ $# -gt 0 ]]; do
  case $1 in
    --admin-email) ADMIN_EMAIL=$2; shift 2 ;;
    --domain) DOMAIN=$2; shift 2 ;;
    --razorpay-key-id) RZP_ID=$2; shift 2 ;;
    --razorpay-key-secret) RZP_SECRET=$2; shift 2 ;;
    --branch) BRANCH=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done
BRANCH=${BRANCH:-main}
REPO=${REPO:-https://github.com/srisomesh-ai/datingapp.git}
[[ -n $ADMIN_EMAIL ]] || die "pass --admin-email you@example.com on the first run"
if [[ -n $RZP_ID && -z $RZP_SECRET ]] || [[ -z $RZP_ID && -n $RZP_SECRET ]]; then
  die "pass both --razorpay-key-id and --razorpay-key-secret"
fi

export DEBIAN_FRONTEND=noninteractive

log "Installing system packages"
apt-get update -q
apt-get install -yq curl git ufw sqlite3 coturn ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  log "Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node.js 22.13+ is required (found $(node -v))"

if ! command -v caddy >/dev/null; then
  log "Installing Caddy (web server with automatic HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

PUBLIC_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me)
[[ $PUBLIC_IP =~ ^[0-9.]+$ ]] || die "could not detect this server's public IPv4 address"
DOMAIN=${DOMAIN:-${PUBLIC_IP//./-}.sslip.io}
log "Serving at https://$DOMAIN (server IP $PUBLIC_IP)"

log "Creating app user and folders"
id -u $APP >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin $APP
mkdir -p "$APP_DIR" "$DATA_DIR/uploads" "$BACKUP_DIR"
chown -R $APP:$APP "$APP_DIR" "$DATA_DIR"
chmod 750 "$DATA_DIR" "$BACKUP_DIR"

log "Fetching code ($REPO, branch $BRANCH)"
as_app() { runuser -u $APP -- env HOME="$DATA_DIR" npm_config_cache="$DATA_DIR/.npm" "$@"; }
if [[ -d $APP_DIR/.git ]]; then
  as_app git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  as_app git -C "$APP_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
else
  [[ -z $(ls -A "$APP_DIR") ]] || die "$APP_DIR exists but is not a git checkout; move it away and re-run"
  as_app git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

log "Installing dependencies and building the web app"
as_app npm --prefix "$APP_DIR/server" ci --omit=dev --no-audit --no-fund
as_app npm --prefix "$APP_DIR/client" ci --no-audit --no-fund
as_app npm --prefix "$APP_DIR/client" run build

log "Writing configuration ($ENV_FILE)"
JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
TURN_SECRET=${TURN_SECRET:-$(openssl rand -hex 32)}
umask 077
cat > "$ENV_FILE" <<EOF
# Managed by deploy/setup.sh. Re-run the script after editing to apply.
NODE_ENV=production
PORT=$PORT
DOMAIN=$DOMAIN
DEPLOY_REPO=$REPO
DEPLOY_BRANCH=$BRANCH
JWT_SECRET=$JWT_SECRET
ADMIN_EMAILS=$ADMIN_EMAIL
DB_FILE=$DATA_DIR/app.db
UPLOAD_DIR=$DATA_DIR/uploads
TURN_URLS=turn:$DOMAIN:3478?transport=udp,turn:$DOMAIN:3478?transport=tcp
TURN_SECRET=$TURN_SECRET
RAZORPAY_KEY_ID=$RZP_ID
RAZORPAY_KEY_SECRET=$RZP_SECRET
EOF
if [[ -z $RZP_ID ]]; then
  echo "ALLOW_MOCK_PAYMENTS=1" >> "$ENV_FILE"
fi
umask 022

log "Setting up the app service"
cat > /etc/systemd/system/$APP.service <<EOF
[Unit]
Description=$APP (API, realtime chat and call signaling)
After=network-online.target
Wants=network-online.target

[Service]
User=$APP
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) --disable-warning=ExperimentalWarning src/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet $APP
systemctl restart $APP

log "Setting up the TURN relay (coturn) so calls work on mobile data"
cat > /etc/turnserver.conf <<EOF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=$TURN_SECRET
realm=$DOMAIN
external-ip=$PUBLIC_IP
min-port=49152
max-port=65535
total-quota=200
stale-nonce=600
no-cli
no-tls
no-dtls
no-multicast-peers
# Never relay into private / local networks.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
log-file=syslog
EOF
[[ -f /etc/default/coturn ]] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable --quiet coturn
systemctl restart coturn

log "Setting up HTTPS (Caddy)"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	request_body {
		max_size 5MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl enable --quiet caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

log "Configuring the firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw allow 3478 >/dev/null
ufw allow 49152:65535/udp >/dev/null
ufw --force enable >/dev/null

log "Daily database backups ($BACKUP_DIR, last 14 kept)"
cat > /etc/cron.daily/$APP-backup <<EOF
#!/bin/sh
sqlite3 $DATA_DIR/app.db ".backup '$BACKUP_DIR/app-\$(date +%F).db'"
find $BACKUP_DIR -name 'app-*.db' -mtime +14 -delete
EOF
chmod 755 /etc/cron.daily/$APP-backup

log "Waiting for the app to come up"
for i in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  [[ $i -eq 30 ]] && { journalctl -u $APP -n 50 --no-pager; die "the app did not start (logs above)"; }
  sleep 2
done
HTTPS_OK=no
for i in $(seq 1 30); do
  if curl -fsS "https://$DOMAIN/api/health" >/dev/null 2>&1; then HTTPS_OK=yes; break; fi
  sleep 3
done

echo
echo "-------------------------------------------------------------------"
echo " App:       https://$DOMAIN"
echo " Admin:     sign up with $ADMIN_EMAIL to get the Admin page"
if [[ -n $RZP_ID ]]; then
  echo " Payments:  Razorpay ($([[ $RZP_ID == rzp_test_* ]] && echo 'TEST mode' || echo 'LIVE'))"
else
  echo " Payments:  MOCK - 'Pay' adds money for free (testing only)"
fi
echo " Calls:     TURN relay on $DOMAIN:3478"
[[ $HTTPS_OK == yes ]] || echo " NOTE: HTTPS isn't answering yet. Check that ports 80/443 are open in your VPS provider's firewall, then: journalctl -u caddy -n 50"
echo " Logs:      journalctl -u $APP -f"
echo " Update:    sudo bash $APP_DIR/deploy/setup.sh"
echo "-------------------------------------------------------------------"
