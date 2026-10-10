"""Register, login, logout and session lookup."""

from flask import Blueprint, current_app, g, jsonify, request

from .. import auth, db
from .common import (
    SESSION_COOKIE,
    clear_session_cookie,
    error,
    login_required,
    parse_json,
    public,
    set_session_cookie,
)

bp = Blueprint("auth", __name__)


def _user_json(user: dict) -> dict:
    return {"id": user["id"], "username": user["username"]}


def _start_session(resp, user_id: int) -> None:
    token, token_hash = auth.new_session_token()
    db.create_session(token_hash, user_id, current_app.config["VAULT"].session_ttl)
    set_session_cookie(resp, token)


@bp.post("/auth/register")
@public
def register():
    data = parse_json({"username", "password"})
    username = auth.normalize_username(str(data.get("username", "")))
    password = str(data.get("password", ""))
    msg = auth.validate_username(username) or auth.validate_password(password)
    if msg:
        return error(400, msg)
    try:
        user_id = db.create_user(username, auth.hash_password(password))
    except db.Duplicate:
        return error(409, "username sudah dipakai")
    resp = jsonify(id=user_id, username=username)
    _start_session(resp, user_id)
    return resp, 201


@bp.post("/auth/login")
@public
def login():
    data = parse_json({"username", "password"})
    user = db.user_by_username(auth.normalize_username(str(data.get("username", ""))))
    # For unknown users check_password still spends a bcrypt comparison, so
    # response time does not reveal which usernames exist.
    if not auth.check_password(user["password_hash"] if user else None, str(data.get("password", ""))):
        return error(401, "username atau password salah")
    db.delete_expired_sessions()
    resp = jsonify(_user_json(user))
    _start_session(resp, user["id"])
    return resp


@bp.post("/auth/logout")
def logout():
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.delete_session(auth.hash_token(token))
    resp = current_app.response_class(status=204)
    clear_session_cookie(resp)
    return resp


@bp.get("/auth/me")
@login_required
def me():
    return jsonify(_user_json(g.user))


@bp.get("/auth/session")
def session():
    """Always 200: {"user": null} when signed out. The frontend calls this on
    page load, where "not signed in" is a normal state, not an error."""
    token = request.cookies.get(SESSION_COOKIE)
    user = db.session_user(auth.hash_token(token)) if token else None
    resp = jsonify(user=_user_json(user) if user else None)
    if token and user is None:
        clear_session_cookie(resp)
    return resp
