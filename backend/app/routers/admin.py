"""Modul Superadmin: peserta, verifikasi, akun juri, tenggat, audit log."""

import sqlite3
from datetime import date, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from starlette import status

from app.core.security import CurrentUser, password_hasher, require_csrf, require_roles
from app.db.audit import log_action
from app.db.items import read_item
from app.db.settings_store import get_setting, set_setting
from app.dependencies import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


class VerifyParticipantRequest(BaseModel):
    approve: bool
    reason: str


class CreateJudgeRequest(BaseModel):
    email: EmailStr
    temporary_password: str


class ParticipantOut(BaseModel):
    id: str
    email: str | None
    verification_status: str
    is_minor: bool | None
    team_id: str | None


class JudgeOut(BaseModel):
    id: str
    email: str


class SettingsOut(BaseModel):
    deadline_at: str | None
    max_team_members: int
    privacy_policy_version: str
    privacy_policy_text: str


class SettingsUpdate(BaseModel):
    deadline_at: datetime | None = None
    max_team_members: int | None = Field(default=None, ge=2)
    privacy_policy_version: str | None = None
    privacy_policy_text: str | None = None


class AuditLogOut(BaseModel):
    id: str
    actor_id: str | None
    action: str
    item_id: str | None
    subject_user_id: str | None
    result: str
    created_at: str


def _is_minor(birth_date: str | None) -> bool | None:
    if not birth_date:
        return None
    try:
        year, month, day = (int(part) for part in birth_date.split("-"))
        born = date(year, month, day)
    except ValueError:
        return None
    today = date.today()
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    return age < 18


@router.get("/participants", response_model=list[ParticipantOut])
def list_participants(
    current_user: CurrentUser = Depends(require_roles("superadmin")),
    db: sqlite3.Connection = Depends(get_db),
) -> list[ParticipantOut]:
    rows = db.execute(
        """SELECT users.id, users.email, users.verification_status, team_members.team_id
           FROM users LEFT JOIN team_members ON team_members.user_id = users.id
           WHERE users.role = 'peserta'
           ORDER BY users.created_at"""
    ).fetchall()

    result = [
        ParticipantOut(
            id=row["id"],
            email=row["email"],
            verification_status=row["verification_status"],
            is_minor=_is_minor(read_item(db, owner_user_id=row["id"], field="birth_date")),
            team_id=row["team_id"],
        )
        for row in rows
    ]

    log_action(db, actor_id=current_user.id, action="list_participants")
    return result


@router.post("/participants/{user_id}/verify", status_code=status.HTTP_204_NO_CONTENT)
def verify_participant(
    user_id: str,
    body: VerifyParticipantRequest,
    current_user: CurrentUser = Depends(require_roles("superadmin")),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> None:
    if not body.reason.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Alasan wajib diisi")

    user = db.execute(
        "SELECT verification_status FROM users WHERE id = ? AND role = 'peserta'", (user_id,)
    ).fetchone()
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if user["verification_status"] == "belum_lengkap":
        raise HTTPException(status.HTTP_409_CONFLICT, "Peserta belum melengkapi dokumen")

    decision = "terverifikasi" if body.approve else "ditolak"
    db.execute(
        "UPDATE users SET verification_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
        "WHERE id = ?",
        (decision, user_id),
    )
    db.execute(
        """INSERT INTO verification_events (id, user_id, admin_id, decision, reason)
               VALUES (?, ?, ?, ?, ?)""",
        (str(uuid4()), user_id, current_user.id, decision, body.reason),
    )
    log_action(db, actor_id=current_user.id, action="verify_participant", subject_user_id=user_id, result=decision)


@router.post("/judges", status_code=status.HTTP_201_CREATED, response_model=JudgeOut)
def create_judge_account(
    body: CreateJudgeRequest,
    current_user: CurrentUser = Depends(require_roles("superadmin")),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> JudgeOut:
    email = body.email.strip().lower()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email sudah terdaftar")

    user_id = str(uuid4())
    db.execute(
        "INSERT INTO users (id, email, password_hash, role, verification_status, must_change_password) "
        "VALUES (?, ?, ?, 'juri', 'terverifikasi', 1)",
        (user_id, email, password_hasher.hash(body.temporary_password)),
    )
    log_action(db, actor_id=current_user.id, action="create_judge_account", subject_user_id=user_id)
    return JudgeOut(id=user_id, email=email)


@router.get("/settings", response_model=SettingsOut)
def get_settings_values(
    current_user: CurrentUser = Depends(require_roles("superadmin")),
    db: sqlite3.Connection = Depends(get_db),
) -> SettingsOut:
    return SettingsOut(
        deadline_at=get_setting(db, "deadline_at"),
        max_team_members=int(get_setting(db, "max_team_members")),
        privacy_policy_version=get_setting(db, "privacy_policy_version"),
        privacy_policy_text=get_setting(db, "privacy_policy_text"),
    )


@router.put("/settings", status_code=status.HTTP_204_NO_CONTENT)
def update_settings_values(
    body: SettingsUpdate,
    current_user: CurrentUser = Depends(require_roles("superadmin")),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> None:
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for key, value in changes.items():
        if isinstance(value, datetime):
            value = value.isoformat()
        set_setting(db, key, str(value), updated_by=current_user.id)
    if changes:
        log_action(db, actor_id=current_user.id, action="update_settings", result=",".join(sorted(changes)))


@router.get("/audit-logs", response_model=list[AuditLogOut])
def list_audit_logs(
    current_user: CurrentUser = Depends(require_roles("superadmin")),
    db: sqlite3.Connection = Depends(get_db),
    limit: int = 100,
    offset: int = 0,
) -> list[AuditLogOut]:
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    rows = db.execute(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?", (limit, offset)
    ).fetchall()
    return [AuditLogOut(**dict(row)) for row in rows]
