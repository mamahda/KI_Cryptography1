"""Entry point FastAPI. Jalankan dengan `python run.py` dari folder backend/."""

from contextlib import asynccontextmanager, closing
from uuid import uuid4

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.security import password_hasher
from app.db.database import connect_db, migrate_db
from app.routers import auth, documents, privacy, profile

settings = get_settings()


def _seed_superadmin() -> None:
    """Buat akun superadmin pertama dari SUPERADMIN_EMAIL/PASSWORD di .env,
    kalau belum ada peserta dengan email itu. Dipakai sekali saat setup awal."""
    if not settings.superadmin_email or not settings.superadmin_password:
        return

    with closing(connect_db(settings.database_path_abs)) as connection:
        email = settings.superadmin_email.strip().lower()
        existing = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing is not None:
            return

        connection.execute(
            "INSERT INTO users (id, email, password_hash, role, verification_status) "
            "VALUES (?, ?, ?, 'superadmin', 'terverifikasi')",
            (str(uuid4()), email, password_hasher.hash(settings.superadmin_password)),
        )
        connection.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    migrate_db(settings.database_path_abs)
    settings.storage_dir_abs.mkdir(parents=True, exist_ok=True)
    _seed_superadmin()
    yield


app = FastAPI(title="Schematics NIC API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

for router in (auth.router, privacy.router, profile.router, documents.router):
    app.include_router(router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
