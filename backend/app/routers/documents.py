"""Modul Dokumen: unggah dan ganti KTP, KTM/KRSM, bukti twibbon."""

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette import status

from app.core.config import Settings, get_settings
from app.core.security import CurrentUser, require_csrf, require_roles
from app.db.items import save_file
from app.db.settings_store import is_past_deadline
from app.dependencies import get_db, read_upload, require_consent

router = APIRouter(prefix="/documents", tags=["documents"])

DOCUMENT_FIELDS = ("ktp", "ktm", "twibbon")
ALLOWED_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}


@router.put("/{doc_type}", status_code=status.HTTP_204_NO_CONTENT)
async def upload_document(
    doc_type: str,
    filename: str,
    request: Request,
    current_user: CurrentUser = Depends(require_roles("peserta")),
    db: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings),
    _csrf: None = Depends(require_csrf),
    _consent: None = Depends(require_consent),
) -> None:
    if doc_type not in DOCUMENT_FIELDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    if is_past_deadline(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Tenggat pendaftaran sudah lewat")

    data, ext, content_type = await read_upload(request, filename, ALLOWED_TYPES, max_mb=5)
    save_file(
        db, field=doc_type, data=data, ext=ext, content_type=content_type,
        storage_dir=settings.storage_dir_abs, owner_user_id=current_user.id,
    )

    # Status jadi "menunggu" kalau ketiga dokumen sudah ada (termasuk saat ganti dokumen).
    uploaded = db.execute(
        "SELECT COUNT(*) FROM items WHERE owner_user_id = ? "
        "AND field IN ('ktp', 'ktm', 'twibbon') AND shredded_at IS NULL",
        (current_user.id,),
    ).fetchone()[0]
    if uploaded == 3:
        db.execute(
            "UPDATE users SET verification_status = 'menunggu', "
            "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            (current_user.id,),
        )
