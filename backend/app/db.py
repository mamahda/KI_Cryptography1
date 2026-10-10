"""Every SQL query the server runs against MariaDB / MySQL.

One connection per request is kept in flask.g and closed when the request
ends. Queries return plain dicts (DictCursor)."""

import os
import time
from contextlib import contextmanager
from datetime import datetime, timezone

import pymysql
from flask import current_app, g
from pymysql.cursors import DictCursor

SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")


def connect(cfg) -> pymysql.connections.Connection:
    return pymysql.connect(
        host=cfg.db_host,
        port=cfg.db_port,
        user=cfg.db_user,
        password=cfg.db_password,
        database=cfg.db_name,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
        # UTC everywhere so NOW() in SQL and Python agree.
        init_command="SET time_zone = '+00:00'",
    )


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["VAULT"])
    return g.db


def close_db(_exc=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def wait_and_migrate(cfg, timeout: float = 60) -> None:
    """Connects (retrying while the database starts) and applies schema.sql.
    Every statement there is CREATE TABLE IF NOT EXISTS."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            conn = connect(cfg)
            break
        except pymysql.err.OperationalError:
            if time.monotonic() > deadline:
                raise
            time.sleep(2)
    try:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            sql = "".join(line for line in f if not line.lstrip().startswith("--"))
        with conn.cursor() as cur:
            for stmt in sql.split(";"):
                if stmt.strip():
                    cur.execute(stmt)
    finally:
        conn.close()


@contextmanager
def transaction():
    conn = get_db()
    conn.begin()
    try:
        yield conn.cursor()
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def iso(dt: datetime | None) -> str | None:
    """DATETIME values are UTC; mark them so browsers don't read them as local time."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


class Duplicate(Exception):
    pass


def _q(sql: str, *args) -> list[dict]:
    with get_db().cursor() as cur:
        cur.execute(sql, args)
        return list(cur.fetchall())


def _one(sql: str, *args) -> dict | None:
    rows = _q(sql, *args)
    return rows[0] if rows else None


def _exec(sql: str, *args) -> int:
    with get_db().cursor() as cur:
        return cur.execute(sql, args)


# --- users & sessions ---------------------------------------------------------


def create_user(username: str, password_hash: str) -> int:
    try:
        with get_db().cursor() as cur:
            cur.execute("INSERT INTO users (username, password_hash) VALUES (%s, %s)", (username, password_hash))
            return cur.lastrowid
    except pymysql.err.IntegrityError as e:
        if e.args and e.args[0] == 1062:  # duplicate key
            raise Duplicate() from e
        raise


def user_by_username(username: str) -> dict | None:
    return _one("SELECT id, username, password_hash FROM users WHERE username = %s", username)


def create_session(token_hash: bytes, user_id: int, ttl_seconds: int) -> None:
    _exec(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, DATE_ADD(NOW(6), INTERVAL %s SECOND))",
        token_hash,
        user_id,
        ttl_seconds,
    )


def session_user(token_hash: bytes) -> dict | None:
    """The user owning an unexpired session."""
    return _one(
        "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token_hash = %s AND s.expires_at > NOW(6)",
        token_hash,
    )


def delete_session(token_hash: bytes) -> None:
    _exec("DELETE FROM sessions WHERE token_hash = %s", token_hash)


def delete_expired_sessions() -> int:
    return _exec("DELETE FROM sessions WHERE expires_at <= NOW(6)")


# --- profiles -----------------------------------------------------------------


def save_profile(user_id: int, records: list[dict]) -> None:
    """Replaces all encrypted versions of a user's profile at once."""
    with transaction() as cur:
        for r in records:
            cur.execute(
                "INSERT INTO profiles (user_id, algorithm, iv, ciphertext, mac, encrypt_ns) "
                "VALUES (%s, %s, %s, %s, %s, %s) "
                "ON DUPLICATE KEY UPDATE iv = VALUES(iv), ciphertext = VALUES(ciphertext), "
                "mac = VALUES(mac), encrypt_ns = VALUES(encrypt_ns), updated_at = CURRENT_TIMESTAMP(6)",
                (user_id, r["algorithm"], r["iv"], r["ciphertext"], r["mac"], r["encrypt_ns"]),
            )


def profile(user_id: int, algorithm: str) -> dict | None:
    return _one(
        "SELECT algorithm, iv, ciphertext, mac, encrypt_ns, updated_at FROM profiles "
        "WHERE user_id = %s AND algorithm = %s",
        user_id,
        algorithm,
    )


# --- files --------------------------------------------------------------------

_FILE_VARIANT_COLUMNS = (
    "f.id, f.user_id, f.category, f.mime_type, f.size_plain, f.created_at, "
    "v.algorithm, v.storage_path, v.iv, v.mac, v.name_iv, v.name_ciphertext, v.name_mac, "
    "v.size_cipher, v.encrypt_ns, v.encrypt_total_ns"
)


def create_file(f: dict, variants: list[dict]) -> None:
    with transaction() as cur:
        cur.execute(
            "INSERT INTO files (id, user_id, category, mime_type, size_plain) VALUES (%s, %s, %s, %s, %s)",
            (f["id"], f["user_id"], f["category"], f["mime_type"], f["size_plain"]),
        )
        for v in variants:
            cur.execute(
                "INSERT INTO file_variants (file_id, algorithm, storage_path, iv, mac, name_iv, name_ciphertext, "
                "name_mac, size_cipher, encrypt_ns, encrypt_total_ns) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    f["id"],
                    v["algorithm"],
                    v["storage_path"],
                    v["iv"],
                    v["mac"],
                    v["name_iv"],
                    v["name_ciphertext"],
                    v["name_mac"],
                    v["size_cipher"],
                    v["encrypt_ns"],
                    v["encrypt_total_ns"],
                ),
            )


def list_files(user_id: int, category: str | None, algorithm: str) -> list[dict]:
    """The user's files joined with one variant (used to decrypt the
    filename), newest first."""
    sql = (
        f"SELECT {_FILE_VARIANT_COLUMNS} FROM files f "
        "JOIN file_variants v ON v.file_id = f.id AND v.algorithm = %s WHERE f.user_id = %s"
    )
    args: list = [algorithm, user_id]
    if category:
        sql += " AND f.category = %s"
        args.append(category)
    sql += " ORDER BY f.created_at DESC, f.id"
    return _q(sql, *args)


def file_variant(user_id: int, file_id: str, algorithm: str) -> dict | None:
    return _one(
        f"SELECT {_FILE_VARIANT_COLUMNS} FROM files f JOIN file_variants v ON v.file_id = f.id "
        "WHERE f.id = %s AND f.user_id = %s AND v.algorithm = %s",
        file_id,
        user_id,
        algorithm,
    )


def file_variants(user_id: int, file_id: str) -> list[dict]:
    """Every variant of a file owned by user_id, in AES, DES, RC4 order
    (ENUM columns sort by declaration order)."""
    return _q(
        f"SELECT {_FILE_VARIANT_COLUMNS} FROM files f JOIN file_variants v ON v.file_id = f.id "
        "WHERE f.id = %s AND f.user_id = %s ORDER BY v.algorithm",
        file_id,
        user_id,
    )


def delete_file(user_id: int, file_id: str) -> list[str] | None:
    """Deletes a file and its variants. Returns the storage paths to remove
    from disk, or None if the file does not exist or is not the user's."""
    with transaction() as cur:
        cur.execute(
            "SELECT v.storage_path FROM files f JOIN file_variants v ON v.file_id = f.id "
            "WHERE f.id = %s AND f.user_id = %s FOR UPDATE",
            (file_id, user_id),
        )
        paths = [r["storage_path"] for r in cur.fetchall()]
        if cur.execute("DELETE FROM files WHERE id = %s AND user_id = %s", (file_id, user_id)) == 0:
            return None
        return paths


def file_owned(user_id: int, file_id: str) -> dict | None:
    return _one(
        "SELECT id, user_id, category, mime_type, size_plain, created_at FROM files WHERE id = %s AND user_id = %s",
        file_id,
        user_id,
    )


# --- benchmarks ---------------------------------------------------------------


def insert_benchmarks(user_id: int, rows: list[dict]) -> None:
    if not rows:
        return
    with get_db().cursor() as cur:
        cur.executemany(
            "INSERT INTO benchmarks (user_id, file_id, algorithm, operation, source, bytes, run_index, duration_ns) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            [
                (
                    user_id,
                    r.get("file_id"),
                    r["algorithm"],
                    r["operation"],
                    r["source"],
                    r["bytes"],
                    r.get("run_index", 0),
                    r["duration_ns"],
                )
                for r in rows
            ],
        )


def benchmark_summaries(user_id: int) -> list[dict]:
    return _q(
        "SELECT file_id, algorithm, operation, source, COUNT(*) AS runs, AVG(bytes) AS bytes, "
        "AVG(duration_ns) AS mean_ns, MIN(duration_ns) AS min_ns, MAX(duration_ns) AS max_ns, "
        "COALESCE(STDDEV_SAMP(duration_ns), 0) AS stddev_ns "
        "FROM benchmarks WHERE user_id = %s "
        "GROUP BY file_id, algorithm, operation, source "
        "ORDER BY file_id, operation, source, algorithm",
        user_id,
    )


def benchmarks(user_id: int, limit: int) -> list[dict]:
    return _q(
        "SELECT file_id, algorithm, operation, source, bytes, run_index, duration_ns, created_at "
        "FROM benchmarks WHERE user_id = %s ORDER BY id LIMIT %s",
        user_id,
        limit,
    )


def delete_benchmarks(user_id: int) -> None:
    _exec("DELETE FROM benchmarks WHERE user_id = %s", user_id)
