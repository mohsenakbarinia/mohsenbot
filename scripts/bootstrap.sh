#!/usr/bin/env bash
set -euo pipefail

echo "=== NEXORA AI Bootstrap ==="

if [ -f /etc/os-release ]; then
  . /etc/os-release
  echo "Detected OS: ${PRETTY_NAME:-Unknown}"
fi

for cmd in docker openssl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: Required command '$cmd' is not installed."
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 plugin is required."
  exit 1
fi

mkdir -p data storage/uploads docker/certs backups

if [ ! -f .env ]; then
  cp .env.example .env
  APP_SECRET_VAL=$(openssl rand -hex 32)
  JWT_SECRET_VAL=$(openssl rand -hex 32)
  PG_PASS_VAL=$(openssl rand -hex 16)
  REDIS_PASS_VAL=$(openssl rand -hex 16)
  sed -i "s|CHANGE_ME_GENERATE_64_CHAR_RANDOM_HEX|${APP_SECRET_VAL}|g" .env
  sed -i "s|CHANGE_ME_GENERATE_JWT_SECRET|${JWT_SECRET_VAL}|g" .env
  sed -i "s|CHANGE_ME_POSTGRES_PASSWORD|${PG_PASS_VAL}|g" .env
  sed -i "s|CHANGE_ME_REDIS_PASSWORD|${REDIS_PASS_VAL}|g" .env
  chmod 600 .env
  echo "Created .env from .env.example with local internal DB/JWT secrets."
  echo "ACTION REQUIRED: Set GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, ADMIN_BOOTSTRAP_EMAIL, and ADMIN_BOOTSTRAP_PASSWORD in .env before starting."
  exit 0
fi

chmod 600 .env
docker compose up -d postgres redis
echo "Waiting for PostgreSQL..."
sleep 5
docker compose run --rm backend alembic upgrade head
docker compose up -d
./scripts/healthcheck.sh
echo "NEXORA AI bootstrap complete."
