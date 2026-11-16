# NEXORA AI — Deployment Guide (Ubuntu 24.04 + Docker + GitHub Actions)

## 1. VPS Prerequisites

- Ubuntu 24.04 LTS (minimum 2 vCPU, 4 GB RAM)
- Docker Engine & Docker Compose v2
- DNS `A` record pointing `DOMAIN_NAME` to your VPS public IP

## 2. Initial Server Bootstrap

```bash
git clone <your-repo-url> /opt/nexora-ai
cd /opt/nexora-ai
chmod +x scripts/*.sh
./scripts/bootstrap.sh
```

Edit `.env` and populate your external keys (`GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`), then re-run:

```bash
./scripts/bootstrap.sh
```

## 3. Required GitHub Repository Secrets

Configure these in **Settings → Secrets and variables → Actions**:

- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`
- `JWT_SECRET`
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DOMAIN_NAME`

## 4. Updates & Rollback

Pushes to `main` execute `.github/workflows/deploy.yml`, building container images, running Alembic migrations, updating services, and checking `/api/health`. Use `scripts/backup.sh` and `scripts/restore.sh` for database snapshots.
