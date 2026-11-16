#!/usr/bin/env bash
set -euo pipefail

URL="${1:-http://localhost:3000/api/health}"
echo "Checking NEXORA AI health at ${URL}..."
curl -fsS "$URL" | grep -q '"status"' && echo "Health check OK"
