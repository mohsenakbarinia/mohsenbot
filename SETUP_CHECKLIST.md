# NEXORA AI — Setup & Owner Action Checklist

## Implemented in Codebase

- [x] Full-stack Express + WebSocket + React/Vite Admin Console & Telegram Mini App (`server.ts`, `src/`)
- [x] SQLite relational schema + migrations (`src/server/db.ts`) and PostgreSQL + pgvector + Alembic migrations (`backend/migrations/`)
- [x] Real Google Gemini SDK integration (`@google/genai` + Python `google-genai`) with dynamic Model Registry sync & fallback
- [x] Isolated Long-Term Memory Engine (manual/auto/off modes, semantic search, deduplication, contradiction update, expiry)
- [x] 7 Built-in Personalities + Custom Personality Studio + Immutable Safety Policy
- [x] Safe Tool Manager (`calculator`, `datetime`, `memory_search`, `user_profile`, `web_search`, etc.)
- [x] Multimodal Upload Validation + Voice Message STT/TTS + WebSocket Live Voice Broker (`/ws/live`)
- [x] Docker Compose + Optional Local AI Ollama Profile + Nginx + Scripts + GitHub Actions CI/CD

## Owner Actions Required for External Production Services

- [ ] Set `GEMINI_API_KEY` in environment / Secrets panel to enable live Gemini chat, vision, TTS, STT, and Live Voice calls.
- [ ] Set `TELEGRAM_BOT_TOKEN` (from `@BotFather`) and optionally `TELEGRAM_WEBHOOK_URL` / `TELEGRAM_WEBHOOK_SECRET` for public Telegram Bot operation.
- [ ] Set `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` (or use the in-app Super Admin Bootstrap dialog on first launch).
- [ ] Provision Ubuntu 24.04 VPS, configure DNS + TLS certificates under `docker/certs/`, and add GitHub Actions Secrets listed in `DEPLOYMENT.md`.
