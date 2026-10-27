"""Modul Juri: daftar semua tim final dan detailnya. Tidak ada form nilai."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from starlette import status

from app.core.security import CurrentUser, require_roles
from app.db.audit import log_action
from app.db.items import get_active_item, read_item
from app.dependencies import get_db

router = APIRouter(prefix="/judges", tags=["judges"])


class FinalTeamOut(BaseModel):
    id: str
    team_code: str
    team_name: str | None


class FinalTeamMemberOut(BaseModel):
    full_name: str | None
    institution: str | None


class FinalTeamDetailOut(BaseModel):
    id: str
    team_name: str | None
    members: list[FinalTeamMemberOut]
    proposal_item_id: str | None
    video_item_id: str | None
    repo_url: str | None


@router.get("/teams", response_model=list[FinalTeamOut])
def list_final_teams(
    current_user: CurrentUser = Depends(require_roles("juri")),
    db: sqlite3.Connection = Depends(get_db),
) -> list[FinalTeamOut]:
    teams = db.execute("SELECT id, team_code FROM teams WHERE status = 'final'").fetchall()
    result = [
        FinalTeamOut(
            id=team["id"],
            team_code=team["team_code"],
            team_name=read_item(db, owner_team_id=team["id"], field="team_name"),
        )
        for team in teams
    ]
    log_action(db, actor_id=current_user.id, action="list_final_teams")
    return result


@router.get("/teams/{team_id}", response_model=FinalTeamDetailOut)
def get_final_team_detail(
    team_id: str,
    current_user: CurrentUser = Depends(require_roles("juri")),
    db: sqlite3.Connection = Depends(get_db),
) -> FinalTeamDetailOut:
    team = db.execute("SELECT * FROM teams WHERE id = ? AND status = 'final'", (team_id,)).fetchone()
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)

    member_rows = db.execute(
        "SELECT user_id FROM team_members WHERE team_id = ?", (team_id,)
    ).fetchall()
    members = [
        FinalTeamMemberOut(
            full_name=read_item(db, owner_user_id=row["user_id"], field="full_name"),
            institution=read_item(db, owner_user_id=row["user_id"], field="institution"),
        )
        for row in member_rows
    ]

    proposal = get_active_item(db, field="proposal", owner_team_id=team_id)
    video = get_active_item(db, field="video", owner_team_id=team_id)
    log_action(db, actor_id=current_user.id, action="view_team_detail")

    return FinalTeamDetailOut(
        id=team["id"],
        team_name=read_item(db, owner_team_id=team_id, field="team_name"),
        members=members,
        proposal_item_id=proposal["id"] if proposal else None,
        video_item_id=video["id"] if video else None,
        repo_url=read_item(db, owner_team_id=team_id, field="repo_url"),
    )
