#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nexora-ai}"
cd "$APP_DIR"

echo "Pulling latest images and running Alembic migrations..."
docker compose pull
docker compose run --rm backend alembic upgrade head
docker compose up -d --remove-orphans

if ! ./scripts/healthcheck.sh; then
  echo "ERROR: Health check failed after deploy! Initiating rollback..."
  docker compose rollback 2>/dev/null || docker compose down && exit 1
fi

echo "Deployment succeeded."
