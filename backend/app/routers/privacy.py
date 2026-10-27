"""Modul Privasi: pemberitahuan privasi berversi dan persetujuan."""

import sqlite3
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from starlette import status

from app.core.security import CurrentUser, get_current_user, require_csrf
from app.db.settings_store import get_setting
from app.dependencies import get_db

router = APIRouter(prefix="/privacy", tags=["privacy"])


class PrivacyNoticeOut(BaseModel):
    policy_version: str
    policy_text: str


@router.get("/notice", response_model=PrivacyNoticeOut)
def get_current_notice(db: sqlite3.Connection = Depends(get_db)) -> PrivacyNoticeOut:
    return PrivacyNoticeOut(
        policy_version=get_setting(db, "privacy_policy_version"),
        policy_text=get_setting(db, "privacy_policy_text"),
    )


@router.post("/consent", status_code=status.HTTP_204_NO_CONTENT)
def give_consent(
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> None:
    policy_version = get_setting(db, "privacy_policy_version")
    db.execute(
        """INSERT INTO consents (id, user_id, policy_version)
               VALUES (?, ?, ?)
           ON CONFLICT(user_id, policy_version) DO UPDATE SET withdrawn_at = NULL""",
        (str(uuid4()), current_user.id, policy_version),
    )
