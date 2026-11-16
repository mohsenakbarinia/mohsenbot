# NEXORA AI — Security Policy

## Secrets & Credentials

- No API keys, bot tokens, or admin passwords are stored in source control.
- `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN` remain strictly server-side; the Live Voice Mini App communicates through the `/ws/live` WebSocket session broker.
- Admin passwords are hashed with `scrypt` + per-user random salt and verified with constant-time comparison.

## Input, File & Prompt Hardening

- Uploaded files undergo MIME-type allowlisting, dangerous-extension blocking, size limits, path-traversal stripping, and automatic TTL purging.
- Untrusted document payloads are wrapped in `<untrusted_data>` delimiters with immutable system safety directives that custom personalities cannot override.
- Database backups support AES-256-CBC PBKDF2 encryption via `BACKUP_PASSPHRASE`.
