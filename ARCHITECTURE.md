# NEXORA AI — System Architecture

## Request Flow

```text
Telegram User / Mini App / Admin Browser
        │
        ▼
Nginx Reverse Proxy (HTTPS + /ws/live Upgrade)
        │
        ├──► Express / FastAPI Backend
        │       ├── Rate Limiter & Auth / CSRF / Telegram HMAC Verification
        │       ├── AIOrchestrator (Quota Check -> Deduplication -> Safety Policy)
        │       ├── MemoryEngine (Top-K Scoped Retrieval per user_id)
        │       ├── ToolManager (Safe AST/Parser Math, Jalali Date, Scoped Memory)
        │       └── GoogleGeminiProvider (Dynamic Registry + Controlled Fallback)
        │               └── Optional Fallback: Local AI (Ollama)
        │
        ├──► WebSocket Live Voice Broker (/ws/live)
        │       └── Server-side ai.live.connect (16kHz in / 24kHz out PCM; no browser key)
        │
        └──► Persistence
                ├── PostgreSQL + pgvector (Prod) / SQLite WAL (Local Applet)
                └── Redis (Cache & Queue)
```

## Memory Engine Isolation

- Every memory query filters strictly by `user_id`.
- Only Top-K relevant memories (max 5–6) are injected into prompt context; full memory tables are never sent to the model.
- Contradicting `topic_key` entries update existing rows rather than duplicating stale facts.
