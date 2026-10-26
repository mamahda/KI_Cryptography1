"""Sesi JWT di cookie HttpOnly + CSRF double-submit.

Token CSRF disisipkan sebagai claim di JWT sendiri (bukan tabel sesi terpisah),
lalu dicocokkan ke header `X-CSRF-Token` yang wajib dikirim browser untuk
request yang mengubah data. Ini membuat sesi tetap stateless.
"""

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Request, Response
from fastapi.exceptions import HTTPException
from starlette import status

from app.core.config import Settings, get_settings

ACCESS_COOKIE_NAME = "access_token"
CSRF_COOKIE_NAME = "csrf_token"
JWT_ALGORITHM = "HS256"
SESSION_LIFETIME = timedelta(hours=8)


@dataclass
class CurrentUser:
    id: str
    role: str


def _create_token(settings: Settings, user_id: str, role: str, csrf_token: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "csrf": csrf_token,
        "iat": now,
        "exp": now + SESSION_LIFETIME,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=JWT_ALGORITHM)


def set_session_cookies(response: Response, settings: Settings, user_id: str, role: str) -> None:
    """Dipakai oleh endpoint login/register untuk membuka sesi baru."""
    csrf_token = secrets.token_urlsafe(32)
    access_token = _create_token(settings, user_id, role, csrf_token)
    max_age = int(SESSION_LIFETIME.total_seconds())

    response.set_cookie(
        ACCESS_COOKIE_NAME,
        access_token,
        max_age=max_age,
        httponly=True,
        secure=settings.jwt_cookie_secure,
        samesite="lax",
    )
    # Dibaca oleh JavaScript frontend untuk dikirim balik lewat header X-CSRF-Token.
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.jwt_cookie_secure,
        samesite="lax",
    )


def clear_session_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE_NAME)
    response.delete_cookie(CSRF_COOKIE_NAME)


def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
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


def require_csrf(request: Request, settings: Settings = Depends(get_settings)) -> None:
    """Wajib dipasang di endpoint yang mengubah data (POST/PUT/PATCH/DELETE)."""
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tidak ada sesi aktif")

    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesi tidak valid")

    header_token = request.headers.get("X-CSRF-Token")
    if not header_token or not secrets.compare_digest(header_token, payload["csrf"]):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Token CSRF tidak valid")


def require_roles(*roles: str):
    """Dependency factory: `Depends(require_roles("superadmin"))`."""

    def checker(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Tidak punya akses")
        return current_user

    return checker
