"""Modul Auth: registrasi, login, logout, profil singkat (README § Fitur dan aturan bisnis)."""

import sqlite3
from uuid import uuid4

from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from starlette import status

from app.core.config import Settings, get_settings
from app.core.limiter import limiter
from app.core.security import (
    CurrentUser,
    clear_session_cookies,
    get_current_user,
    password_hasher,
    require_csrf,
    set_session_cookies,
)
from app.dependencies import get_db
from app.db.views import me_data

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=128)


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterRequest,
    response: Response,
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    email = body.email.strip().lower()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {"code": "email_taken", "message": "Email sudah terdaftar"},
        )

    user_id = str(uuid4())
    db.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'peserta')",
        (user_id, email, password_hasher.hash(body.password)),
    )
    set_session_cookies(response, settings, user_id=user_id, role="peserta")
    return {"user": me_data(db, user_id)}


@router.post("/login")
@limiter.limit("10/minute")
def login(
    request: Request,
    body: LoginRequest,
    response: Response,
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    row = db.execute(
        "SELECT id, password_hash, role, verification_status, must_change_password FROM users WHERE email = ? AND disabled = 0",
        (body.email.strip().lower(),),
    ).fetchone()
    if row is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            {"code": "invalid_credentials", "message": "Email atau password salah"},
        )

    try:
        password_hasher.verify(row["password_hash"], body.password)
    except VerifyMismatchError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            {"code": "invalid_credentials", "message": "Email atau password salah"},
        )

    set_session_cookies(response, settings, user_id=row["id"], role=row["role"])
    return {"user": me_data(db, row["id"])}


@router.put("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: ChangePasswordRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> None:
    """Dipakai juri yang akun-nya dibuat superadmin (must_change_password=1),
    atau peserta mana pun yang ingin mengganti password."""
    row = db.execute(
        "SELECT password_hash FROM users WHERE id = ?", (current_user.id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesi tidak valid")

    try:
        password_hasher.verify(row["password_hash"], body.current_password)
    except VerifyMismatchError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password lama salah")

    db.execute(
        "UPDATE users SET password_hash = ?, must_change_password = 0, "
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        (password_hasher.hash(body.new_password), current_user.id),
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    current_user: CurrentUser = Depends(get_current_user),
    _csrf: None = Depends(require_csrf),
) -> None:
    clear_session_cookies(response)
