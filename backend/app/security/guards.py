from __future__ import annotations

import hashlib
import hmac
import os
import re
from urllib.parse import parse_qsl

INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"reveal\s+(your\s+)?system\s+prompt", re.I),
    re.compile(r"bypass\s+(safety|security|policy)", re.I),
]

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "audio/ogg",
    "audio/mpeg",
    "audio/wav",
    "audio/webm",
}

DANGEROUS_EXTENSIONS = {".exe", ".sh", ".bat", ".cmd", ".ps1", ".js", ".py", ".php"}


def detect_prompt_injection(text: str) -> list[str]:
    hits: list[str] = []
    for pat in INJECTION_PATTERNS:
        hits.extend(pat.findall(text))
    return hits


def validate_upload(filename: str, mime_type: str, size_bytes: int, max_bytes: int = 20 * 1024 * 1024) -> tuple[bool, str]:
    if size_bytes <= 0 or size_bytes > max_bytes:
        return False, "Invalid file size"
    if not filename or ".." in filename or "/" in filename or "\\" in filename:
        return False, "Path traversal characters prohibited"
    base = os.path.basename(filename)
    if not base or base.startswith("."):
        return False, "Invalid filename"
    ext = os.path.splitext(base)[1].lower()
    if ext in DANGEROUS_EXTENSIONS:
        return False, f"Executable extension prohibited: {ext}"
    clean_mime = mime_type.split(";")[0].strip().lower()
    if clean_mime not in ALLOWED_MIME_TYPES:
        return False, f"Unsupported MIME type: {clean_mime}"
    return True, "ok"


def redact_secrets(text: str) -> str:
    text = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "[REDACTED_GEMINI_KEY]", text)
    text = re.sub(r"\b\d{8,11}:[A-Za-z0-9_-]{30,}\b", "[REDACTED_TELEGRAM_TOKEN]", text)
    return text


def verify_telegram_webapp_init_data(init_data: str, bot_token: str) -> bool:
    if not init_data or not bot_token:
        return False
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        return False
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return hmac.compare_digest(calculated, received_hash)
