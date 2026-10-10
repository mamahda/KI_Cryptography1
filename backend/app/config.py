"""Server settings, read from environment variables and backend/.env."""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

from .crypto import SECRET_SIZE


@dataclass(frozen=True)
class Config:
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str
    server_secret: bytes  # root secret for HKDF key derivation
    storage_dir: str  # where encrypted files are written
    host: str
    port: int
    cookie_secure: bool  # set Secure on the session cookie (HTTPS only)
    session_ttl: int  # seconds
    static_dir: str | None  # optional built frontend to serve


class ConfigError(Exception):
    pass


def _bool(value: str) -> bool:
    v = value.strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off", ""):
        return False
    raise ConfigError(f"not a boolean: {value!r}")


def load_config(env_file: str = ".env") -> Config:
    """Loads env_file (if present) without overriding variables already set."""
    load_dotenv(env_file, override=False)
    env = os.environ.get

    secret_hex = (env("SERVER_SECRET") or "").strip()
    if not secret_hex:
        raise ConfigError("SERVER_SECRET is not set (generate one with: openssl rand -hex 32)")
    try:
        secret = bytes.fromhex(secret_hex)
    except ValueError as e:
        raise ConfigError("SERVER_SECRET must be hex") from e
    if len(secret) < SECRET_SIZE:
        raise ConfigError(f"SERVER_SECRET must be at least {SECRET_SIZE} bytes ({2 * SECRET_SIZE} hex chars)")

    try:
        return Config(
            db_host=env("DB_HOST", "127.0.0.1"),
            db_port=int(env("DB_PORT", "3306")),
            db_user=env("DB_USER", "vault"),
            db_password=env("DB_PASSWORD", "vault"),
            db_name=env("DB_NAME", "vault"),
            server_secret=secret,
            storage_dir=env("STORAGE_DIR", "../storage"),
            host=env("HOST", "127.0.0.1"),
            port=int(env("PORT", "8080")),
            cookie_secure=_bool(env("COOKIE_SECURE", "false")),
            session_ttl=int(env("SESSION_TTL_HOURS", "24")) * 3600,
            static_dir=env("STATIC_DIR") or None,
        )
    except ValueError as e:
        raise ConfigError(str(e)) from e
