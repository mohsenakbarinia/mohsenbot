from __future__ import annotations

import hmac
from fastapi import FastAPI, Header, HTTPException, Request

from app.ai.orchestrator.orchestrator import AIOrchestrator
from app.ai.providers.gemini_provider import GoogleGeminiProvider
from app.config.settings import get_settings

app = FastAPI(title="NEXORA AI Backend", version="1.0.0")


@app.get("/api/health")
async def health() -> dict:
    settings = get_settings()
    gemini = GoogleGeminiProvider(settings)
    return {
        "status": "healthy",
        "gemini_configured": gemini.is_configured(),
        "telegram_configured": bool(settings.telegram_bot_token),
        "telegram_mode": settings.telegram_mode,
        "local_ai_enabled": settings.local_ai_enabled,
    }


@app.post("/api/chat")
async def chat_endpoint(payload: dict) -> dict:
    settings = get_settings()
    orchestrator = AIOrchestrator(settings)
    message = str(payload.get("message", "")).strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    return await orchestrator.process_chat(
        prompt=message,
        personality_prompt=str(payload.get("personality_prompt", "Adaptive helpful assistant")),
    )


@app.post("/api/telegram/webhook")
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict:
    settings = get_settings()
    if settings.telegram_webhook_secret:
        if not x_telegram_bot_api_secret_token or not hmac.compare_digest(
            x_telegram_bot_api_secret_token, settings.telegram_webhook_secret
        ):
            raise HTTPException(status_code=403, detail="Invalid webhook secret")
    _update = await request.json()
    return {"ok": True}
