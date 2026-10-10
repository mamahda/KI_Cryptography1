"""Flask application factory for the Secure Personal Data Vault API."""

import logging
import os
import time

from flask import Flask, Request, current_app, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from . import db, filetype
from .config import Config, load_config
from .storage import Storage


class VaultRequest(Request):
    """Spools uploaded files into storage/.tmp as anonymous temp files, so
    upload plaintext never lands in a shared system temp directory."""

    def _get_file_stream(self, total_content_length, content_type, filename=None, content_length=None):
        return current_app.extensions["vault_storage"].temp_file()


def create_app(cfg: Config | None = None, migrate: bool = True) -> Flask:
    cfg = cfg or load_config()
    app = Flask(__name__, static_folder=None)
    app.request_class = VaultRequest
    app.config["VAULT"] = cfg
    # Werkzeug answers 413 before reading a body bigger than this.
    app.config["MAX_CONTENT_LENGTH"] = filetype.MAX_UPLOAD_SIZE + 1024 * 1024
    app.config["JSON_SORT_KEYS"] = False
    app.extensions["vault_storage"] = Storage(cfg.storage_dir)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if migrate:
        db.wait_and_migrate(cfg)

    from .routes import auth_routes, bench_routes, file_routes, profile_routes

    for bp in (auth_routes.bp, profile_routes.bp, file_routes.bp, bench_routes.bp):
        app.register_blueprint(bp, url_prefix="/api")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok")

    app.teardown_appcontext(db.close_db)

    @app.before_request
    def start_timer():
        g.start = time.perf_counter()

    @app.after_request
    def finish(resp):
        h = resp.headers
        h["X-Content-Type-Options"] = "nosniff"
        h["X-Frame-Options"] = "DENY"
        h["Referrer-Policy"] = "no-referrer"
        if request.path.startswith("/api/"):
            h["Cache-Control"] = "no-store"
        ms = (time.perf_counter() - g.get("start", time.perf_counter())) * 1000
        app.logger.info("%s %s %s %.1fms", request.method, request.path, resp.status_code, ms)
        return resp

    @app.errorhandler(HTTPException)
    def http_error(e: HTTPException):
        messages = {
            404: "endpoint tidak ditemukan",
            405: "method tidak diizinkan",
            413: f"ukuran upload melebihi batas maksimum {filetype.MAX_UPLOAD_SIZE // filetype.MB} MB",
        }
        if not request.path.startswith("/api/") and e.code == 404 and cfg.static_dir:
            return send_from_directory(cfg.static_dir, "index.html")
        return jsonify(error=messages.get(e.code, e.description)), e.code

    @app.errorhandler(Exception)
    def server_error(e: Exception):
        app.logger.exception("internal error on %s %s", request.method, request.path)
        return jsonify(error="terjadi kesalahan di server"), 500

    if cfg.static_dir:
        # Serve the built frontend (frontend/dist) from the same server.
        @app.get("/")
        @app.get("/<path:path>")
        def spa(path: str = ""):
            if path.startswith("api/"):
                return jsonify(error="endpoint tidak ditemukan"), 404
            full = os.path.join(cfg.static_dir, path)
            if path and os.path.isfile(full):
                return send_from_directory(cfg.static_dir, path)
            return send_from_directory(cfg.static_dir, "index.html")

    return app
