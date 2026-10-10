"""Helpers shared by all route modules."""

import functools
import re
import uuid

from flask import current_app, g, jsonify, request

from .. import auth, db
from ..crypto import Keys, parse_algorithm

SESSION_COOKIE = "vault_session"
MAX_JSON_BODY = 64 * 1024
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class BadRequest(Exception):
    pass


def error(status: int, message: str):
    return jsonify(error=message), status


def integrity_error(what: str):
    current_app.logger.warning("integrity check failed on %s (%s)", request.path, what)
    return error(422, f"verifikasi integritas {what} gagal (HMAC tidak cocok): data rusak atau telah dimodifikasi")


def parse_json(allowed: set[str]) -> dict:
    """Reads exactly one JSON object and rejects unknown fields."""
    if (request.content_length or 0) > MAX_JSON_BODY:
        raise BadRequest("body terlalu besar")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("body JSON tidak valid")
    unknown = set(data) - allowed
    if unknown:
        raise BadRequest(f"body JSON tidak valid: field tidak dikenal {sorted(unknown)}")
    return data


def alg_param() -> str:
    """Reads ?alg=, defaulting to AES."""
    value = request.args.get("alg", "")
    if not value:
        return "AES"
    try:
        return parse_algorithm(value)
    except ValueError:
        raise BadRequest("parameter alg harus AES, DES, atau RC4") from None


def new_uuid() -> str:
    return str(uuid.uuid4())


def user_keys() -> Keys:
    return Keys(current_app.config["VAULT"].server_secret, g.user["username"])


def storage():
    return current_app.extensions["vault_storage"]


def timing(sealed_or_stats) -> dict:
    s = getattr(sealed_or_stats, "stats", sealed_or_stats)
    return {"cipher_ns": s.cipher_ns, "total_ns": s.total_ns}


def set_session_cookie(resp, token: str) -> None:
    cfg = current_app.config["VAULT"]
    resp.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=cfg.session_ttl,
        path="/",
        httponly=True,
        secure=cfg.cookie_secure,
        samesite="Lax",
    )


def clear_session_cookie(resp) -> None:
    cfg = current_app.config["VAULT"]
    resp.delete_cookie(SESSION_COOKIE, path="/", httponly=True, secure=cfg.cookie_secure, samesite="Lax")


def login_required(view):
    """Resolves the session cookie to g.user or answers 401."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return error(401, "silakan login terlebih dahulu")
        user = db.session_user(auth.hash_token(token))
        if user is None:
            resp = jsonify(error="sesi sudah berakhir, silakan login ulang")
            clear_session_cookie(resp)
            return resp, 401
        g.user = user
        try:
            return view(*args, **kwargs)
        except BadRequest as e:
            return error(400, str(e))

    return wrapper


def public(view):
    """For routes without login: turns BadRequest into a 400 response."""

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except BadRequest as e:
            return error(400, str(e))

    return wrapper

