"""Public-key registry; private keys and passphrases stay in the browser."""

import base64
import binascii
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from Crypto.PublicKey import RSA
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.security import CurrentUser, get_current_user, require_csrf
from app.dependencies import get_db, require_consent


class NoStoreRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def no_store(request):
            try:
                response = await handler(request)
            except RequestValidationError:
                raise HTTPException(
                    400, {"code": "validation_error", "message": "Data tidak valid"},
                    headers={"Cache-Control": "no-store"},
                ) from None
            except StarletteHTTPException as exc:
                exc.headers = {**(exc.headers or {}), "Cache-Control": "no-store"}
                raise
            except Exception:
                raise HTTPException(
                    500, {"code": "internal_error", "message": "Terjadi kesalahan server"},
                    headers={"Cache-Control": "no-store"},
                ) from None
            response.headers["Cache-Control"] = "no-store"
            return response

        return no_store


def sharing_participant(
    current_user: CurrentUser = Depends(get_current_user),
    db: sqlite3.Connection = Depends(get_db),
) -> CurrentUser:
    user = db.execute(
        "SELECT 1 FROM users WHERE id = ? AND role = 'peserta' AND disabled = 0",
        (current_user.id,),
    ).fetchone()
    if user is None:
        raise HTTPException(404, "Tidak punya akses")
    try:
        require_consent(current_user, db)
    except HTTPException as exc:
        raise HTTPException(404, "Tidak punya akses") from exc
    return current_user


router = APIRouter(
    prefix="/sharing/keys", tags=["sharing"], route_class=NoStoreRoute,
)


class RegisterPublicKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    public_key_spki_b64: str = Field(min_length=1, max_length=1024)


def public_key_der(encoded: str) -> bytes:
    try:
        der = base64.b64decode(encoded, validate=True)
        key = RSA.import_key(der)
        if (
            key.has_private() or key.size_in_bits() != 2048
            or key.export_key(format="DER") != der
            or base64.b64encode(der).decode("ascii") != encoded
        ):
            raise ValueError("Not a canonical RSA-2048 SPKI public key")
    except (ValueError, IndexError, TypeError, binascii.Error):
        raise HTTPException(400, "Public key harus SPKI DER RSA 2048-bit dalam base64 standar") from None
    return der


def key_response(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "public_key_spki_b64": base64.b64encode(row["public_key_spki"]).decode("ascii"),
    }


@router.post("", status_code=201)
def register_key(
    body: RegisterPublicKey,
    response: Response,
    current_user: CurrentUser = Depends(sharing_participant),
    db: sqlite3.Connection = Depends(get_db),
    _csrf: None = Depends(require_csrf),
) -> dict:
    der = public_key_der(body.public_key_spki_b64)
    inserted = db.execute(
        "INSERT INTO sharing_public_keys (id, user_id, public_key_spki, created_at) "
        "VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING",
        (str(uuid4()), current_user.id, der, datetime.now(timezone.utc).isoformat()),
    ).rowcount
    row = db.execute(
        "SELECT id, public_key_spki FROM sharing_public_keys WHERE user_id = ?",
        (current_user.id,),
    ).fetchone()
    if row["public_key_spki"] != der:
        raise HTTPException(409, "Public key sudah terdaftar; penggantian key tidak didukung")
    response.status_code = 201 if inserted else 200
    return key_response(row)


@router.get("/me")
def my_key(
    current_user: CurrentUser = Depends(sharing_participant),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    row = db.execute(
        "SELECT id, public_key_spki FROM sharing_public_keys WHERE user_id = ?",
        (current_user.id,),
    ).fetchone()
    return {"key": key_response(row) if row else None}
