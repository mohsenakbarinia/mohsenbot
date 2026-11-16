#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

source .env
OUT_FILE="${BACKUP_DIR}/nexora_${STAMP}.sql.gz"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-nexora}" "${POSTGRES_DB:-nexora_ai}" | gzip > "${OUT_FILE}"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "${OUT_FILE}" -out "${OUT_FILE}.enc" -pass env:BACKUP_PASSPHRASE
  rm -f "${OUT_FILE}"
  echo "Encrypted backup created: ${OUT_FILE}.enc"
else
  echo "Backup created: ${OUT_FILE} (set BACKUP_PASSPHRASE for AES-256 encryption)"
fi
