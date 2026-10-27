# Backend — Schematics NIC

FastAPI + SQLite. Lihat [`API.md`](./API.md) untuk daftar endpoint, dan README di root repo untuk kebutuhan tugas secara keseluruhan.

Backend ini hanya berisi logic utama aplikasi. Semua data disimpan **plaintext** (tanpa enkripsi); enkripsi dan benchmark dikerjakan tim lain di luar kode ini.

## Menjalankan

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # isi JWT_SECRET_KEY (ROOT_KEY opsional, belum dipakai backend)
python run.py
```

`run.py` menjalankan `uvicorn` dengan reload otomatis (`APP_DEBUG=true`). Migration SQLite dan folder `storage/` dibuat otomatis saat startup (lihat `app/main.py`).

## Struktur folder

```
backend/
  run.py              # entry point: python run.py
  requirements.txt
  .env / .env.example
  API.md              # dokumentasi endpoint
  data/               # file SQLite (gitignored)
  storage/            # file upload KTP/KTM/twibbon/proposal/video, plaintext (gitignored)
  app/
    main.py           # bikin FastAPI app, daftarkan router, lifespan (migration + seed superadmin)
    dependencies.py   # dependency & helper bersama (koneksi DB, consent, baca upload)
    core/
      config.py       # Settings dari .env (pydantic-settings)
      security.py     # sesi JWT di cookie, CSRF, hash password Argon2id
      limiter.py      # instance slowapi Limiter bersama
    db/
      database.py     # koneksi SQLite + migration runner
      migrations_before_crypto/001_initial.sql  # skema plaintext yang AKTIF sekarang
      migrations/001_initial.sql                # skema versi kripto (dari repo, belum dipakai)
      items.py        # baca/tulis field teks dan file di tabel items
      settings_store.py  # key-value tabel `settings` (tenggat, batas anggota, kebijakan privasi)
      audit.py        # tulis baris ke `audit_logs`
    routers/
      auth.py         # registrasi, login, logout, ganti password, /me
      privacy.py      # pemberitahuan privasi + persetujuan
      profile.py      # baca/ubah data diri peserta
      documents.py    # upload KTP/KTM/twibbon
      teams.py        # buat/gabung/keluar tim, kode tim, keluarkan anggota
      items.py        # upload proposal/video, repo-url, submit-final, buka file (GET /items/{id})
      judges.py       # daftar & detail tim final (read-only untuk juri)
      admin.py        # peserta, verifikasi, akun juri, settings, audit log
```

Router memanggil `app/db/*.py` lewat parameter `db: sqlite3.Connection` dari dependency `get_db` (satu koneksi per request, auto commit/rollback). Tidak pakai ORM.

### Dua folder migration

`app/db/database.py` membaca migration dari `migrations_before_crypto/` (konstanta `MIGRATIONS`). Folder `migrations/` adalah skema versi kripto dari repo (tabel `ciphertexts`, `benchmark_runs`, `users.email_index`) dan sengaja tidak disentuh. Saat enkripsi siap, `MIGRATIONS` diarahkan kembali ke `migrations/`.

## Keamanan (ringkas)

- **Sesi**: JWT di cookie HttpOnly `access_token` (berlaku 8 jam). `get_current_user` membaca dan memvalidasi JWT; `require_roles(...)` membatasi endpoint ke role tertentu.
- **CSRF (double-submit)**: saat login server juga memasang cookie `csrf_token` yang bisa dibaca JavaScript. Request yang mengubah data wajib mengirim nilai itu di header `X-CSRF-Token`; `require_csrf` mencocokkan keduanya.
- **Password**: Argon2id (`password_hasher` di `app/core/security.py`).
- **Consent**: `require_consent` menolak edit profil/upload dokumen sebelum peserta menyetujui kebijakan privasi versi aktif.

## Model data

- **`users`**: akun (email lowercase, hash password, role, status verifikasi).
- **`items`**: setiap field data diri, dokumen, dan karya tim adalah satu baris, dimiliki satu user ATAU satu tim. Teks (nama, NIM, nama tim, repo_url) ada di kolom `value`; file disimpan di `storage/` sebagai `<uuid>.<ekstensi>` dan namanya di kolom `path`.
- Menulis ulang field yang sudah ada menandai item lama sebagai `shredded_at` (file lamanya ikut dihapus), lalu membuat item baru.

## Fungsi per file

### `app/main.py`
- `_seed_superadmin()`: buat akun superadmin pertama dari `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` kalau email itu belum terdaftar.
- `lifespan(app)`: jalankan migration, buat folder storage, seed superadmin.
- `health()`: `GET /health`.

### `app/dependencies.py`
- `get_db()`: buka koneksi SQLite per request; commit kalau sukses, rollback kalau error.
- `require_consent()`: 403 kalau peserta belum setuju kebijakan privasi versi aktif.
- `read_upload(request, filename, allowed, max_mb)`: baca body upload, cek ekstensi (415), kosong (400), dan ukuran (413); kembalikan `(isi, ekstensi, content_type)`.

### `app/core/config.py`
- `Settings` / `get_settings()`: baca `.env`. Path `data/` dan `storage/` relatif ke folder `backend/`.

### `app/core/security.py`
- `set_session_cookies()` / `clear_session_cookies()`: pasang/hapus cookie `access_token` dan `csrf_token`.
- `get_current_user()`: decode JWT dari cookie, 401 kalau tidak ada/kedaluwarsa/tidak valid.
- `require_csrf()`: 403 kalau header `X-CSRF-Token` tidak sama dengan cookie `csrf_token`.
- `require_roles(*roles)`: 403 kalau role user tidak termasuk.
- `password_hasher`: instance Argon2id bersama.

### `app/core/limiter.py`
- `limiter`: rate limit, dipakai di `auth.login` dan `teams.join_team` (10/menit).

### `app/db/database.py`
- `connect_db()`: koneksi SQLite (WAL, foreign keys, `check_same_thread=False` karena endpoint upload `async def` memakai koneksi dari thread lain).
- `migrate_db()`: jalankan file `NNN_*.sql` di folder `MIGRATIONS` yang belum diterapkan.

### `app/db/items.py`
- `write_item()` / `read_item()`: tulis/baca field teks.
- `save_file()`: simpan file upload ke `storage/`, hapus file lama untuk field yang sama.
- `get_active_item()`: baris item aktif untuk (pemilik, field), dipakai untuk cek kelengkapan.
- `get_item()`: baris item berdasarkan id, dipakai `GET /items/{id}`.

### `app/db/settings_store.py`
- `get_setting()` / `set_setting()`: baca/tulis tabel `settings`, dengan nilai default di `DEFAULTS`.
- `is_past_deadline()`: `True` kalau `deadline_at` sudah lewat.

### `app/db/audit.py`
- `log_action()`: tambah satu baris `audit_logs`.

### Router
- **`auth.py`**: `register`, `login`, `change_password` (mengosongkan `must_change_password`), `logout`, `me`.
- **`privacy.py`**: `get_current_notice`, `give_consent`.
- **`profile.py`**: `get_my_profile` (email dari `users`, sisanya dari `items`), `update_my_profile` (status kembali ke `menunggu` kalau nama/NIM/institusi diubah setelah terverifikasi).
- **`documents.py`**: `upload_document`; status peserta jadi `menunggu` begitu ketiga dokumen ada.
- **`teams.py`**: `create_team`, `join_team`, `leave_team`, `get_my_team`, `remove_member`; helper `_team_out` menyusun response tim.
- **`items.py`**: `upload_proposal`, `upload_video`, `set_repo_url`, `submit_final`, `open_item`; helper `_get_editable_team` mengecek user adalah ketua, tim belum final, dan tenggat belum lewat.
- **`judges.py`**: `list_final_teams`, `get_final_team_detail`.
- **`admin.py`**: `list_participants`, `verify_participant`, `create_judge_account`, `get_settings_values`, `update_settings_values`, `list_audit_logs`; helper `_is_minor` menghitung umur dari tanggal lahir.
