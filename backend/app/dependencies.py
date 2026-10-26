"""Dependency FastAPI yang dipakai bersama oleh semua router."""

import sqlite3
from collections.abc import Generator

from fastapi import Depends

from app.core.config import Settings, get_settings
from app.db.database import connect_db


def get_db(settings: Settings = Depends(get_settings)) -> Generator[sqlite3.Connection, None, None]:
    """Satu koneksi SQLite per request; commit jika sukses, rollback jika error."""
    connection = connect_db(settings.database_path_abs)
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
