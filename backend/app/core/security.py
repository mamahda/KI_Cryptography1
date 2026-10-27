"""Sesi JWT di cookie HttpOnly, CSRF double-submit, dan hash password."""

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from fastapi import Depends, HTTPException, Request, Response
from starlette import status

from app.core.config import Settings, get_settings

ACCESS_COOKIE_NAME = "access_token"
CSRF_COOKIE_NAME = "csrf_token"
JWT_ALGORITHM = "HS256"
SESSION_LIFETIME = timedelta(hours=8)

# Argon2id dengan parameter minimum OWASP: memori 19 MiB, 2 iterasi, paralelisme 1.
password_hasher = PasswordHasher(memory_cost=19 * 1024, time_cost=2, parallelism=1)


@dataclass
class CurrentUser:
    id: str
    role: str


def set_session_cookies(response: Response, settings: Settings, user_id: str, role: str) -> None:
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": user_id, "role": role, "iat": now, "exp": now + SESSION_LIFETIME},
        settings.jwt_secret_key,
        algorithm=JWT_ALGORITHM,
    )
    max_age = int(SESSION_LIFETIME.total_seconds())
    response.set_cookie(
        ACCESS_COOKIE_NAME, token, max_age=max_age,
        httponly=True, secure=settings.jwt_cookie_secure, samesite="lax",
    )
    # Tidak HttpOnly: dibaca JavaScript frontend lalu dikirim balik lewat header X-CSRF-Token.
    response.set_cookie(
        CSRF_COOKIE_NAME, secrets.token_urlsafe(32), max_age=max_age,
        httponly=False, secure=settings.jwt_cookie_secure, samesite="lax",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME)
    response.delete_cookie(CSRF_COOKIE_NAME)


def get_current_user(request: Request, settings: Settings = Depends(get_settings)) -> CurrentUser:
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tidak ada sesi aktif")

    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesi kedaluwarsa")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesi tidak valid")

    return CurrentUser(id=payload["sub"], role=payload["role"])


def require_csrf(request: Request) -> None:
    """Wajib di endpoint yang mengubah data: header X-CSRF-Token harus sama dengan cookie csrf_token."""
    cookie = request.cookies.get(CSRF_COOKIE_NAME)
    header = request.headers.get("X-CSRF-Token")
    if not cookie or not header or not secrets.compare_digest(cookie, header):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Token CSRF tidak valid")


def require_roles(*roles: str):
    """Dependency factory: `Depends(require_roles("superadmin"))`."""

    def checker(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Tidak punya akses")
        return current_user

    return checker
