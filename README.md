# NEXORA AI

**NEXORA AI** is a public bilingual (**Persian RTL / English LTR**) AI assistant platform combining:

1. **Telegram Bot** (`Aiogram 3`, Polling & Webhook)
2. **Telegram Mini App & Live Voice Studio** (Real-time 16kHz/24kHz WebSocket PCM streaming via Gemini Live API)
3. **SaaS Admin Console** (19 operational, analytics, routing, personality, memory, billing, and security views)
4. **AI Orchestrator & Dynamic Model Registry** (Google Gemini SDK + optional Ollama Local AI fallback)
5. **Isolated Long-Term Memory Engine** (Semantic vector search, deduplication, contradiction updates, expiration)
6. **Multimodal Processing & Sandboxed Tools** (Vision, PDF/DOCX/CSV/JSON analysis, STT, TTS, safe math, Jalali date/time)

## Quick Start (Local Full-Stack Applet)

```bash
cp .env.example .env
# Set GEMINI_API_KEY in .env (or via AI Studio Secrets)
npm install
npm test
npm run dev
```

Visit `http://localhost:3000`.

## Quick Start (Production Docker Compose)

```bash
chmod +x scripts/*.sh
./scripts/bootstrap.sh
```

See `DEPLOYMENT.md` for VPS provisioning, DNS/TLS, and GitHub Actions setup.
