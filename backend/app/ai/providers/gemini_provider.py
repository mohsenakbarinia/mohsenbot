from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Optional

from app.config.settings import Settings


@dataclass
class GeminiErrorInfo:
    code: int
    status: str
    transient: bool
    configuration_required: bool
    message: str


class GeminiErrorHandler:
    @staticmethod
    def classify(exc: Exception) -> GeminiErrorInfo:
        msg = str(exc)
        lower = msg.lower()
        if "api_key" in lower or "401" in lower:
            return GeminiErrorInfo(401, "CONFIGURATION_REQUIRED", False, True, "Invalid or missing GEMINI_API_KEY")
        if "403" in lower or "permission_denied" in lower:
            return GeminiErrorInfo(403, "PERMISSION_DENIED", False, True, "Permission denied for requested Gemini model")
        if "429" in lower or "resource_exhausted" in lower:
            return GeminiErrorInfo(429, "RESOURCE_EXHAUSTED", True, False, "Gemini rate limit or quota reached")
        if "404" in lower or "not_found" in lower:
            return GeminiErrorInfo(404, "MODEL_NOT_FOUND", False, False, "Model not found in Gemini registry")
        if "timeout" in lower or "503" in lower or "500" in lower:
            return GeminiErrorInfo(503, "TRANSIENT_UPSTREAM", True, False, "Transient Gemini upstream error")
        return GeminiErrorInfo(502, "UPSTREAM_ERROR", False, False, msg)


class GeminiModelRegistry:
    DEFAULT_CAPABILITIES = {
        "general_chat": "gemini-4-hydrogen",
        "reasoning": "gemini-4-argon",
        "deep_reasoning": "gemini-4-carbon",
        "lite": "gemini-3.1-flash-lite",
        "audio_transcription": "gemini-3.5-transcribe",
        "live_voice": "gemini-3.8-live",
        "tts": "gemini-3.8-flash-lite-tts",
        "vision": "gemini-4-hydrogen",
    }

    FALLBACK_CHAIN = {
        "gemini-4-carbon": "gemini-4-argon",
        "gemini-4-argon": "gemini-4-hydrogen",
        "gemini-4-hydrogen": "gemini-3.1-flash-lite",
        "gemini-3.8-flash-tts": "gemini-3.8-flash-lite-tts",
    }

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.available_models: set[str] = set(self.DEFAULT_CAPABILITIES.values())

    def resolve(self, task: str) -> str:
        mapping = {
            "general_chat": self.settings.gemini_default_model,
            "reasoning": self.settings.gemini_reasoning_model,
            "deep_reasoning": self.settings.gemini_deep_reasoning_model,
            "lite": self.settings.gemini_lite_model,
            "audio_transcription": self.settings.gemini_audio_model,
            "live_voice": self.settings.gemini_live_model,
            "tts": self.settings.gemini_tts_model,
            "vision": self.settings.gemini_default_model,
        }
        preferred = mapping.get(task, self.settings.gemini_default_model)
        if preferred in self.available_models:
            return preferred
        return self.FALLBACK_CHAIN.get(preferred, "gemini-4-hydrogen")

    def get_fallback(self, model_id: str) -> Optional[str]:
        return self.FALLBACK_CHAIN.get(model_id)


class GoogleGeminiProvider:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.registry = GeminiModelRegistry(settings)
        self._client: Any = None

    def is_configured(self) -> bool:
        key = self.settings.gemini_api_key.strip()
        return len(key) > 10 and not key.startswith("MY_GEMINI")

    def client(self) -> Any:
        if not self.is_configured():
            raise RuntimeError("GEMINI_API_KEY is not configured")
        if self._client is None:
            from google import genai  # Official google-genai SDK

            self._client = genai.Client(api_key=self.settings.gemini_api_key)
        return self._client

    async def sync_registry(self) -> list[str]:
        client = self.client()
        models = await asyncio.to_thread(lambda: list(client.models.list()))
        ids = [m.name.replace("models/", "") for m in models if getattr(m, "name", None)]
        if ids:
            self.registry.available_models.update(ids)
        return ids

    async def generate_text(
        self,
        prompt: str,
        system_instruction: str,
        task: str = "general_chat",
        tools: Optional[list[Any]] = None,
    ) -> dict[str, Any]:
        client = self.client()
        primary = self.registry.resolve(task)
        candidates = [primary]
        fb = self.registry.get_fallback(primary)
        if fb:
            candidates.append(fb)

        last_exc: Optional[Exception] = None
        for idx, model_id in enumerate(candidates):
            for attempt in range(2):
                try:
                    config: dict[str, Any] = {"system_instruction": system_instruction}
                    if tools:
                        config["tools"] = tools
                    resp = await asyncio.to_thread(
                        client.models.generate_content,
                        model=model_id,
                        contents=prompt,
                        config=config,
                    )
                    usage = getattr(resp, "usage_metadata", None)
                    return {
                        "text": (getattr(resp, "text", "") or "").strip(),
                        "model": model_id,
                        "fallback_used": idx > 0,
                        "input_tokens": getattr(usage, "prompt_token_count", 0) or 0,
                        "output_tokens": getattr(usage, "candidates_token_count", 0) or 0,
                    }
                except Exception as exc:
                    last_exc = exc
                    info = GeminiErrorHandler.classify(exc)
                    if not info.transient or attempt == 1:
                        break
                    await asyncio.sleep(0.4 * (attempt + 1))

        assert last_exc is not None
        raise last_exc
