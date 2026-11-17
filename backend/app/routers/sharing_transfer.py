"""Encrypted key export and AES ciphertext delivery for approved sharing."""

import base64
import re
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, require_roles
from app.db.settings_store import get_setting
from app.dependencies import get_db

router = APIRouter(prefix="/sharing/requests", tags=["sharing"])

SHAREABLE_FIELDS = (
    "full_name", "nim", "study_program", "institution", "birth_date",
    "domicile", "phone", "ktp", "ktm", "twibbon",
)
NO_STORE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
_STORAGE_NAME = re.compile(r"[0-9a-f-]{36}\.enc\Z")


def _not_found() -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": "Data tidak ditemukan"})


def _authorized_request(
    db: sqlite3.Connection, request_id: str, user_id: str, *, owner: bool,
) -> sqlite3.Row:
    """Check the approved request and current consent of both parties."""
    row = db.execute(
        "SELECT r.*, o.disabled AS owner_disabled, p.disabled AS requester_disabled "
        "FROM sharing_requests r "
        "JOIN users o ON o.id = r.owner_id "
        "JOIN users p ON p.id = r.requester_id "
        "WHERE r.id = ? AND r.status = 'approved'",
        (request_id,),
    ).fetchone()
    if (row is None or row["owner_id" if owner else "requester_id"] != user_id
            or row["owner_disabled"] or row["requester_disabled"]):
        raise _not_found()
    policy = get_setting(db, "privacy_policy_version")
    for party_id in (row["owner_id"], row["requester_id"]):
        consent = db.execute(
            "SELECT 1 FROM consents WHERE user_id = ? AND policy_version = ? "
            "AND withdrawn_at IS NULL", (party_id, policy),
        ).fetchone()
        if consent is None:
            raise _not_found()
    return row


def _grants(db: sqlite3.Connection, request_id: str) -> list[sqlite3.Row]:
    """Return only grants still bound to active owner items and AES rows."""
    return db.execute(
        "SELECT g.*, i.owner_user_id, i.field, i.content_type, i.size_bytes, "
        "i.storage, c.nonce, c.hmac_tag, c.key_version, c.blob, c.path "
        "FROM sharing_grants g "
        "JOIN sharing_requests r ON r.id = g.request_id "
        "JOIN items i ON i.id = g.item_id "
        "JOIN ciphertexts c ON c.id = g.ciphertext_id AND c.item_id = i.id "
        "AND c.cipher = 'aes' "
        "WHERE g.request_id = ? AND i.owner_user_id = r.owner_id "
        "AND i.owner_team_id IS NULL AND i.parent_item_id IS NULL "
        "AND i.shredded_at IS NULL AND i.field IN (" + ",".join("?" for _ in SHAREABLE_FIELDS) + ") "
        "ORDER BY i.field, i.id",
        (request_id, *SHAREABLE_FIELDS),
    ).fetchall()


def _b64(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _metadata(row: sqlite3.Row) -> dict:
    return {
        "item_id": row["item_id"], "ciphertext_id": row["ciphertext_id"],
        "field": row["field"], "cipher": "aes", "key_version": row["key_version"],
        "nonce_b64": _b64(row["nonce"]), "hmac_tag_b64": _b64(row["hmac_tag"]),
        "content_type": row["content_type"] or "text/plain; charset=utf-8",
        "size_bytes": row["size_bytes"],
    }


@router.get("/{request_id}/key-file")
def get_key_file(
    request_id: str,
    current_user: CurrentUser = Depends(require_roles("peserta")),
    db: sqlite3.Connection = Depends(get_db),
) -> JSONResponse:
    sharing = _authorized_request(db, request_id, current_user.id, owner=True)
    rows = _grants(db, request_id)
    if not rows:
        raise _not_found()
    key_ids = {row["recipient_key_id"] for row in rows}
    if len(key_ids) != 1:
        raise _not_found()
    key_id = key_ids.pop()
    key = db.execute(
        "SELECT 1 FROM sharing_public_keys WHERE id = ? AND user_id = ?",
        (key_id, sharing["requester_id"]),
    ).fetchone()
    if key is None:
        raise _not_found()
    payload = {
        "format": "schematics-share-keys-v1",
        "request_id": request_id,
        "owner_id": sharing["owner_id"],
        "recipient_id": sharing["requester_id"],
        "recipient_key_id": key_id,
        "algorithm": "RSA-OAEP-256",
        "items": [
            {"item_id": row["item_id"], "ciphertext_id": row["ciphertext_id"],
             "encrypted_key_b64": _b64(row["encrypted_key"])} for row in rows
        ],
    }
    return JSONResponse(payload, headers={
        **NO_STORE,
        "Content-Disposition": f'attachment; filename="sharing-{request_id}.json"',
    })


@router.get("/{request_id}/items")
def list_shared_items(
    request_id: str,
    current_user: CurrentUser = Depends(require_roles("peserta")),
    db: sqlite3.Connection = Depends(get_db),
) -> JSONResponse:
    _authorized_request(db, request_id, current_user.id, owner=False)
    return JSONResponse(
        {"items": [_metadata(row) for row in _grants(db, request_id)]},
        headers=NO_STORE,
    )


@router.get("/{request_id}/items/{item_id}/ciphertext")
def get_shared_ciphertext(
    request_id: str, item_id: str,
    current_user: CurrentUser = Depends(require_roles("peserta")),
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    _authorized_request(db, request_id, current_user.id, owner=False)
    row = next((r for r in _grants(db, request_id) if r["item_id"] == item_id), None)
    if row is None:
        raise _not_found()
    if row["path"] is None:
        if row["storage"] != "db" or row["blob"] is None:
            raise _not_found()
        data = row["blob"]
    else:
        if row["storage"] != "fs" or not _STORAGE_NAME.fullmatch(row["path"]):
            raise _not_found()
        target = Path(settings.storage_dir_abs) / row["path"]
        try:
            data = target.read_bytes()
        except OSError:
            raise _not_found() from None
    return Response(data, media_type="application/octet-stream", headers=NO_STORE)
