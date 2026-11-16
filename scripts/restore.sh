#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup.sql.gz | backup.sql.gz.enc>"
  exit 1
fi

TARGET="$1"
source .env

if [[ "$TARGET" == *.enc ]]; then
  : "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required to decrypt backup}"
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$TARGET" -pass env:BACKUP_PASSPHRASE | gunzip | docker compose exec -T postgres psql -U "${POSTGRES_USER:-nexora}" "${POSTGRES_DB:-nexora_ai}"
else
  gunzip -c "$TARGET" | docker compose exec -T postgres psql -U "${POSTGRES_USER:-nexora}" "${POSTGRES_DB:-nexora_ai}"
fi

echo "Restore completed from $TARGET"
