"""Modul Profil: mengisi dan mengubah data diri (satu field = satu baris items)."""

import sqlite3

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from starlette import status

from app.core.security import CurrentUser, get_current_user, require_csrf, require_roles
from app.db.items import read_item, write_item
from app.dependencies import get_db, require_consent

router = APIRouter(prefix="/profile", tags=["profile"])

# Email ikut ditampilkan di GET /me (dari tabel users), tapi tidak bisa diubah di sini.
EDITABLE_FIELDS = (
    "full_name",
    "nim",
    "study_program",
    "institution",
    "birth_date",
    "domicile",
    "phone",
)
# Mengubah salah satu ini setelah terverifikasi mengembalikan status ke "menunggu".
IDENTITY_FIELDS = {"full_name", "nim", "institution"}


class ProfileOut(BaseModel):
    email: str | None = None
    full_name: str | None = None
    nim: str | None = None
    study_program: str | None = None
    institution: str | None = None
    birth_date: str | None = None
    domicile: str | None = None
    phone: str | None = None


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    nim: str | None = None
    study_program: str | None = None
    institution: str | None = None
    birth_date: str | None = None
    domicile: str | None = None
    phone: str | None = None


@router.get("/me", response_model=ProfileOut)
def get_my_profile(
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> ProfileOut:
    user = db.execute("SELECT email FROM users WHERE id = ?", (current_user.id,)).fetchone()
    return ProfileOut(
        email=user["email"] if user is not None else None,
        **{field: read_item(db, owner_user_id=current_user.id, field=field) for field in EDITABLE_FIELDS},
    )


@router.put("/me", status_code=status.HTTP_204_NO_CONTENT)
def update_my_profile(
    body: ProfileUpdate,
    current_user: CurrentUser = Depends(require_roles("peserta")),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
    _consent: None = Depends(require_consent),
) -> None:
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    touched_identity = False
    for field, value in changes.items():
        write_item(db, owner_user_id=current_user.id, field=field, value=value)
        if field in IDENTITY_FIELDS:
            touched_identity = True

    if touched_identity:
        db.execute(
            "UPDATE users SET verification_status = 'menunggu', "
            "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
            "WHERE id = ? AND verification_status = 'terverifikasi'",
            (current_user.id,),
        )
