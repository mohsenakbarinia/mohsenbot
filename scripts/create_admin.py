#!/usr/bin/env python3
"""Secure CLI utility to bootstrap the initial Super Admin from environment variables."""
from __future__ import annotations

import hashlib
import os
import secrets
import sys


def hash_scrypt(password: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt.encode("utf-8"), n=16384, r=8, p=1, dklen=64)
    return f"scrypt:{salt}:{derived.hex()}"


def main() -> int:
    email = os.getenv("ADMIN_BOOTSTRAP_EMAIL", "").strip().lower()
    password = os.getenv("ADMIN_BOOTSTRAP_PASSWORD", "")
    if not email or len(password) < 8:
        print("ERROR: ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (min 8 chars) must be set in environment.", file=sys.stderr)
        return 1
    pw_hash = hash_scrypt(password)
    print(f"Prepared Super Admin record for {email} (hash prefix: {pw_hash[:18]}...)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
