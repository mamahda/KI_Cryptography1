"""Entry point FastAPI. Jalankan dengan `python run.py` dari folder backend/."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import get_settings
from app.core.limiter import limiter
from app.db.database import migrate_db

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    migrate_db(settings.database_path_abs)
    settings.storage_dir_abs.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Schematics NIC API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Router per modul (auth, profil, dokumen, tim, items, juri, admin) didaftarkan
# di sini begitu modul masing-masing siap.


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
