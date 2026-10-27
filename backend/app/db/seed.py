"""Seeder akun superadmin.

Jalankan dari folder backend/ (venv aktif, .env sudah terisi ROOT_KEY/JWT_SECRET_KEY):
    python -m app.db.seed
"""

from contextlib import closing

from app.core.config import get_settings
from app.core.security import password_hasher
from app.db.database import connect_db, migrate_db
from app.db.users import create_user, email_taken

SUPERADMIN_EMAIL = "admin.dummy@schematics-dummy.com"
SUPERADMIN_PASSWORD = "Password123!"


def seed() -> None:
    settings = get_settings()
    migrate_db(settings.database_path_abs)

    with closing(connect_db(settings.database_path_abs)) as db:
        if email_taken(db, SUPERADMIN_EMAIL):
            print("Superadmin dummy sudah ada, seeding dilewati.")
            return

        create_user(
            db,
            email=SUPERADMIN_EMAIL,
            password_hash=password_hasher.hash(SUPERADMIN_PASSWORD),
            role="superadmin",
            verification_status="terverifikasi",
        )
        db.commit()

    print("Superadmin dummy dibuat:")
    print("  Email   :", SUPERADMIN_EMAIL)
    print("  Password:", SUPERADMIN_PASSWORD)


if __name__ == "__main__":
    seed()
