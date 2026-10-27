"""Modul Submission dan File: karya tim, submit final, dan membuka file/item."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, field_validator
from starlette import status

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, get_current_user, require_csrf
from app.db.audit import log_action
from app.db.items import get_active_item, get_item, save_file, write_item
from app.db.settings_store import get_setting, is_past_deadline
from app.dependencies import get_db, read_upload
from app.routers.documents import DOCUMENT_FIELDS
from app.routers.profile import EDITABLE_FIELDS

router = APIRouter(prefix="/items", tags=["items"])

TEAM_FIELDS = ("proposal", "video", "repo_url")


class RepoUrlRequest(BaseModel):
    repo_url: str

    @field_validator("repo_url")
    @classmethod
    def _must_be_github(cls, value: str) -> str:
        if not value.startswith(("https://github.com/", "http://github.com/")):
            raise ValueError("repo_url harus link GitHub")
        return value


class SubmitFinalRequest(BaseModel):
    confirm: bool  # konfirmasi dua langkah: frontend minta konfirmasi dulu


def _get_editable_team(db: sqlite3.Connection, current_user: CurrentUser) -> sqlite3.Row:
    """Tim yang dipimpin user ini, selama belum final dan tenggat belum lewat."""
    team = db.execute("SELECT * FROM teams WHERE leader_id = ?", (current_user.id,)).fetchone()
    if team is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Hanya ketua tim yang bisa melakukan ini")
    if team["status"] == "final":
        raise HTTPException(status.HTTP_409_CONFLICT, "Tim sudah submit final")
    if is_past_deadline(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Tenggat pengumpulan sudah lewat")
    return team


@router.put("/proposal", status_code=status.HTTP_204_NO_CONTENT)
async def upload_proposal(
    filename: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _csrf: None = Depends(require_csrf),
) -> None:
    team = _get_editable_team(db, current_user)
    data, ext, content_type = await read_upload(request, filename, {"pdf": "application/pdf"}, max_mb=10)
    save_file(
        db, field="proposal", data=data, ext=ext, content_type=content_type,
        storage_dir=settings.storage_dir_abs, owner_team_id=team["id"],
    )


@router.put("/video", status_code=status.HTTP_204_NO_CONTENT)
async def upload_video(
    filename: str,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _csrf: None = Depends(require_csrf),
) -> None:
    team = _get_editable_team(db, current_user)
    data, ext, content_type = await read_upload(request, filename, {"mp4": "video/mp4"}, max_mb=100)
    save_file(
        db, field="video", data=data, ext=ext, content_type=content_type,
        storage_dir=settings.storage_dir_abs, owner_team_id=team["id"],
    )


@router.put("/repo-url", status_code=status.HTTP_204_NO_CONTENT)
def set_repo_url(
    body: RepoUrlRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> None:
    team = _get_editable_team(db, current_user)
    write_item(db, owner_team_id=team["id"], field="repo_url", value=body.repo_url)


@router.post("/submit-final", status_code=status.HTTP_204_NO_CONTENT)
def submit_final(
    body: SubmitFinalRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> None:
    if not body.confirm:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Konfirmasi dibutuhkan untuk submit final")
    team = _get_editable_team(db, current_user)

    members = db.execute("SELECT user_id FROM team_members WHERE team_id = ?", (team["id"],)).fetchall()
    max_members = int(get_setting(db, "max_team_members"))
    if not (2 <= len(members) <= max_members):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Tim harus berisi 2-{max_members} anggota")

    for member in members:
        for field in EDITABLE_FIELDS:
            if get_active_item(db, field=field, owner_user_id=member["user_id"]) is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "Ada anggota yang belum lengkap data diri")
        for field in DOCUMENT_FIELDS:
            if get_active_item(db, field=field, owner_user_id=member["user_id"]) is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "Ada anggota yang belum lengkap dokumen")

    for field in TEAM_FIELDS:
        if get_active_item(db, field=field, owner_team_id=team["id"]) is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Proposal, video, dan link GitHub wajib diisi")

    db.execute(
        "UPDATE teams SET status = 'final', finalized_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        (team["id"],),
    )


@router.get("/{item_id}")
def open_item(
    item_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    # Item yang tidak ada dan yang tidak boleh dibuka sama-sama dijawab 404.
    item = get_item(db, item_id)
    if item is None or item["shredded_at"] is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    is_mine = item["owner_user_id"] == current_user.id
    if item["owner_team_id"] is not None:
        is_mine = db.execute(
            "SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?",
            (item["owner_team_id"], current_user.id),
        ).fetchone() is not None

    can_open = is_mine or current_user.role == "superadmin"
    if not can_open and current_user.role == "juri" and item["field"] in TEAM_FIELDS:
        team = db.execute("SELECT status FROM teams WHERE id = ?", (item["owner_team_id"],)).fetchone()
        can_open = team["status"] == "final"
    if not can_open:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    if not is_mine:
        log_action(
            db, actor_id=current_user.id, action=f"open_item:{item['field']}",
            item_id=item_id, subject_user_id=item["owner_user_id"],
        )

    if item["storage"] == "db":
        return Response(item["value"], media_type="text/plain")
    return FileResponse(settings.storage_dir_abs / item["path"], media_type=item["content_type"])
