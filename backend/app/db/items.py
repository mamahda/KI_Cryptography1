"""Baca/tulis tabel `items`: satu baris = satu field data diri, dokumen, atau karya tim.

Teks disimpan di kolom `value`; file disimpan di folder storage/ dan nama filenya
di kolom `path`. Menulis field yang sudah ada akan men-shred (soft delete) item
lama dulu, jadi selalu ada paling banyak satu item aktif per (pemilik, field).
"""

import sqlite3
from pathlib import Path
from uuid import uuid4


def _owner(owner_user_id: str | None, owner_team_id: str | None) -> tuple[str, str]:
    if owner_user_id is not None:
        return "owner_user_id", owner_user_id
    return "owner_team_id", owner_team_id


def _shred(db: sqlite3.Connection, column: str, owner: str, field: str) -> None:
    db.execute(
        f"UPDATE items SET shredded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
        f"WHERE {column} = ? AND field = ? AND shredded_at IS NULL",
        (owner, field),
    )


def get_active_item(
    db: sqlite3.Connection,
    *,
    field: str,
    owner_user_id: str | None = None,
    owner_team_id: str | None = None,
) -> sqlite3.Row | None:
    column, owner = _owner(owner_user_id, owner_team_id)
    return db.execute(
        f"SELECT * FROM items WHERE {column} = ? AND field = ? AND shredded_at IS NULL",
        (owner, field),
    ).fetchone()


def get_item(db: sqlite3.Connection, item_id: str) -> sqlite3.Row | None:
    return db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()


def read_item(
    db: sqlite3.Connection,
    *,
    field: str,
    owner_user_id: str | None = None,
    owner_team_id: str | None = None,
) -> str | None:
    item = get_active_item(db, field=field, owner_user_id=owner_user_id, owner_team_id=owner_team_id)
    return item["value"] if item is not None else None


def write_item(
    db: sqlite3.Connection,
    *,
    field: str,
    value: str,
    owner_user_id: str | None = None,
    owner_team_id: str | None = None,
) -> None:
    column, owner = _owner(owner_user_id, owner_team_id)
    _shred(db, column, owner, field)
    db.execute(
        f"INSERT INTO items (id, {column}, field, storage, size_bytes, value) VALUES (?, ?, ?, 'db', ?, ?)",
        (str(uuid4()), owner, field, len(value.encode("utf-8")), value),
    )


def save_file(
    db: sqlite3.Connection,
    *,
    field: str,
    data: bytes,
    ext: str,
    content_type: str,
    storage_dir: Path,
    owner_user_id: str | None = None,
    owner_team_id: str | None = None,
) -> None:
    """Simpan file upload ke storage/, ganti file lama untuk field yang sama."""
    old = get_active_item(db, field=field, owner_user_id=owner_user_id, owner_team_id=owner_team_id)
    if old is not None and old["path"]:
        (storage_dir / old["path"]).unlink(missing_ok=True)

    column, owner = _owner(owner_user_id, owner_team_id)
    _shred(db, column, owner, field)

    filename = f"{uuid4()}.{ext}"
    (storage_dir / filename).write_bytes(data)
    db.execute(
        f"INSERT INTO items (id, {column}, field, storage, content_type, size_bytes, path) "
        f"VALUES (?, ?, ?, 'fs', ?, ?, ?)",
        (str(uuid4()), owner, field, content_type, len(data), filename),
    )
