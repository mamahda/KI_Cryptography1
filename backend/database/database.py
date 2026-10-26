"""SQLite setup for the Schematics NIC backend."""

import sqlite3
from contextlib import closing
from pathlib import Path


MIGRATIONS = Path(__file__).with_name("migrations")


def connect_db(database_path: str | Path) -> sqlite3.Connection:
    """Open a configured SQLite connection. The caller closes it."""
    connection = sqlite3.connect(database_path, timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def migrate_db(database_path: str | Path) -> None:
    """Apply pending numbered SQL migrations to the database."""
    Path(database_path).parent.mkdir(parents=True, exist_ok=True)
    with closing(connect_db(database_path)) as connection:
        current = connection.execute("PRAGMA user_version").fetchone()[0]
        migrations = sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql"))
        versions = [int(path.name.split("_", 1)[0]) for path in migrations]

        if current > (versions[-1] if versions else 0):
            raise RuntimeError("Database schema is newer than the available migrations")
        if versions != list(range(1, len(versions) + 1)):
            raise RuntimeError("Migration files must be numbered consecutively from 001")

        for version, migration in zip(versions, migrations):
            if version <= current:
                continue
            try:
                connection.executescript(migration.read_text(encoding="utf-8"))
            except Exception:
                if connection.in_transaction:
                    connection.rollback()
                raise


def init_db(database_path: str | Path) -> None:
    """Backward-compatible name for applying database migrations."""
    migrate_db(database_path)
