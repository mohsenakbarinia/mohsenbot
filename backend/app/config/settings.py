from __future__ import annotations

import os
from dataclasses import dataclass, field

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict  # type: ignore

    class Settings(BaseSettings):
        model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

        app_env: str = "development"
        app_secret: str = ""
        app_url: str = "http://localhost:8000"
        app_debug: bool = False

        gemini_api_key: str = ""
        gemini_default_model: str = "gemini-4-hydrogen"
        gemini_reasoning_model: str = "gemini-4-argon"
        gemini_deep_reasoning_model: str = "gemini-4-carbon"
        gemini_lite_model: str = "gemini-3.1-flash-lite"
        gemini_audio_model: str = "gemini-3.5-transcribe"
        gemini_live_model: str = "gemini-3.8-live"
        gemini_tts_model: str = "gemini-3.8-flash-lite-tts"
        gemini_embedding_model: str = "gemini-embedding-2"

        telegram_bot_token: str = ""
        telegram_mode: str = "polling"
        telegram_webhook_url: str = ""
        telegram_webhook_secret: str = ""
        telegram_miniapp_url: str = ""

        database_url: str = "postgresql+asyncpg://nexora:postgres@postgres:5432/nexora_ai"
        redis_url: str = "redis://redis:6379/0"

        jwt_secret: str = ""
        admin_bootstrap_email: str = ""
        admin_bootstrap_password: str = ""

        local_ai_enabled: bool = False
        local_ai_base_url: str = "http://ollama:11434"
        local_ai_model: str = "qwen2.5:7b-instruct"

        storage_path: str = "./storage/uploads"
        max_upload_size: int = 20 * 1024 * 1024
        temp_file_ttl_minutes: int = 30
        log_level: str = "INFO"
        web_search_provider: str = "gemini_grounding"

except ImportError:

    @dataclass
    class Settings:  # type: ignore[no-redef]
        app_env: str = field(default_factory=lambda: os.getenv("APP_ENV", "development"))
        app_secret: str = field(default_factory=lambda: os.getenv("APP_SECRET", ""))
        app_url: str = field(default_factory=lambda: os.getenv("APP_URL", "http://localhost:8000"))
        app_debug: bool = field(default_factory=lambda: os.getenv("APP_DEBUG", "false").lower() == "true")

        gemini_api_key: str = field(default_factory=lambda: os.getenv("GEMINI_API_KEY", ""))
        gemini_default_model: str = field(default_factory=lambda: os.getenv("GEMINI_DEFAULT_MODEL", "gemini-4-hydrogen"))
        gemini_reasoning_model: str = field(default_factory=lambda: os.getenv("GEMINI_REASONING_MODEL", "gemini-4-argon"))
        gemini_deep_reasoning_model: str = field(default_factory=lambda: os.getenv("GEMINI_DEEP_REASONING_MODEL", "gemini-4-carbon"))
        gemini_lite_model: str = field(default_factory=lambda: os.getenv("GEMINI_LITE_MODEL", "gemini-3.1-flash-lite"))
        gemini_audio_model: str = field(default_factory=lambda: os.getenv("GEMINI_AUDIO_MODEL", "gemini-3.5-transcribe"))
        gemini_live_model: str = field(default_factory=lambda: os.getenv("GEMINI_LIVE_MODEL", "gemini-3.8-live"))
        gemini_tts_model: str = field(default_factory=lambda: os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts"))
        gemini_embedding_model: str = field(default_factory=lambda: os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2"))

        telegram_bot_token: str = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN", ""))
        telegram_mode: str = field(default_factory=lambda: os.getenv("TELEGRAM_MODE", "polling"))
        telegram_webhook_url: str = field(default_factory=lambda: os.getenv("TELEGRAM_WEBHOOK_URL", ""))
        telegram_webhook_secret: str = field(default_factory=lambda: os.getenv("TELEGRAM_WEBHOOK_SECRET", ""))
        telegram_miniapp_url: str = field(default_factory=lambda: os.getenv("TELEGRAM_MINIAPP_URL", ""))

        database_url: str = field(default_factory=lambda: os.getenv("DATABASE_URL", "postgresql+asyncpg://nexora:postgres@postgres:5432/nexora_ai"))
        redis_url: str = field(default_factory=lambda: os.getenv("REDIS_URL", "redis://redis:6379/0"))

        jwt_secret: str = field(default_factory=lambda: os.getenv("JWT_SECRET", ""))
        admin_bootstrap_email: str = field(default_factory=lambda: os.getenv("ADMIN_BOOTSTRAP_EMAIL", ""))
        admin_bootstrap_password: str = field(default_factory=lambda: os.getenv("ADMIN_BOOTSTRAP_PASSWORD", ""))

        local_ai_enabled: bool = field(default_factory=lambda: os.getenv("LOCAL_AI_ENABLED", "false").lower() == "true")
        local_ai_base_url: str = field(default_factory=lambda: os.getenv("LOCAL_AI_BASE_URL", "http://ollama:11434"))
        local_ai_model: str = field(default_factory=lambda: os.getenv("LOCAL_AI_MODEL", "qwen2.5:7b-instruct"))

        storage_path: str = field(default_factory=lambda: os.getenv("STORAGE_PATH", "./storage/uploads"))
        max_upload_size: int = field(default_factory=lambda: int(os.getenv("MAX_UPLOAD_SIZE", str(20 * 1024 * 1024))))
        temp_file_ttl_minutes: int = field(default_factory=lambda: int(os.getenv("TEMP_FILE_TTL_MINUTES", "30")))
        log_level: str = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))
        web_search_provider: str = field(default_factory=lambda: os.getenv("WEB_SEARCH_PROVIDER", "gemini_grounding"))


def get_settings() -> Settings:
    return Settings()
