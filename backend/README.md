# Backend — Secure Personal Data Vault

REST API dalam **Python (Flask)** yang menyimpan data pribadi, foto KTP, dokumen, dan video. Setiap data dienkripsi **tiga kali**, masing-masing dengan AES-256-CTR, DES-CTR, dan RC4-drop[3072], memakai **PyCryptodome**. Integritasnya dijaga dengan HMAC-SHA256.

## Prasyarat
- Python ≥ 3.10
- MariaDB ≥ 10.6 yang sudah terpasang dan berjalan. MySQL 8 juga bisa.

## Menyiapkan database (sekali saja)
Buat database dan user khusus aplikasi. Jalankan sebagai root MariaDB (di Linux biasanya `sudo mariadb`):
```sql
CREATE DATABASE IF NOT EXISTS vault CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'vault'@'localhost' IDENTIFIED BY 'vault';
CREATE USER IF NOT EXISTS 'vault'@'127.0.0.1' IDENTIFIED BY 'vault';
GRANT ALL PRIVILEGES ON vault.* TO 'vault'@'localhost';
GRANT ALL PRIVILEGES ON vault.* TO 'vault'@'127.0.0.1';
FLUSH PRIVILEGES;
```
Satu baris perintah:
```bash
sudo mariadb -e "CREATE DATABASE IF NOT EXISTS vault CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER IF NOT EXISTS 'vault'@'localhost' IDENTIFIED BY 'vault'; CREATE USER IF NOT EXISTS 'vault'@'127.0.0.1' IDENTIFIED BY 'vault'; GRANT ALL PRIVILEGES ON vault.* TO 'vault'@'localhost'; GRANT ALL PRIVILEGES ON vault.* TO 'vault'@'127.0.0.1'; FLUSH PRIVILEGES;"
```
User dibuat untuk dua host (`localhost` dan `127.0.0.1`) karena backend terhubung lewat TCP ke `127.0.0.1`, dan MariaDB bisa mengenali koneksi itu dengan nama host yang mana saja. Password `vault` hanya untuk development lokal. Kalau diganti, sesuaikan `DB_PASSWORD` di `.env`.

Tabel tidak perlu dibuat manual. Server menjalankan `app/schema.sql` setiap kali start.

## Menjalankan
```bash
cd backend
python -m venv .venv
source .venv/bin/activate              # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# isi SERVER_SECRET di .env dengan hasil perintah ini:
python -c "import secrets; print(secrets.token_hex(32))"

python run.py                          # API di http://localhost:8080
```
Ciphertext file disimpan di `../storage/`.

## Konfigurasi (`.env`)
| Variabel | Default | Keterangan |
|---|---|---|
| `DB_HOST`, `DB_PORT` | `127.0.0.1`, `3306` | alamat MariaDB |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | `vault`, `vault`, `vault` | kredensial dan nama database |
| `SERVER_SECRET` | — (wajib) | 32 byte hex, akar HKDF. **Jangan diganti atau hilang**, karena semua data lama tidak akan bisa didekripsi lagi. |
| `STORAGE_DIR` | `../storage` | lokasi file `.enc` |
| `HOST`, `PORT` | `127.0.0.1`, `8080` | alamat server |
| `COOKIE_SECURE` | `false` | `true` kalau server diakses lewat HTTPS |
| `SESSION_TTL_HOURS` | `24` | umur session |
| `STATIC_DIR` | — | opsional: folder `frontend/dist` untuk di-serve sekaligus oleh server ini |

## Struktur
```
run.py                    menjalankan server
bench.py                  benchmark CLI → CSV untuk laporan
app/__init__.py           create_app(): konfigurasi Flask, error handler, header keamanan
app/crypto.py             HKDF, AES-CTR, DES-CTR, RC4-drop, HMAC, entropi  ← inti tugas
app/auth.py               bcrypt, validasi username/password, token session
app/db.py                 semua query SQL (PyMySQL)
app/schema.sql            definisi tabel
app/filetype.py           validasi upload (ekstensi, magic bytes, ukuran)
app/storage.py            baca/tulis file .enc
app/stats.py              mean/median/stddev/throughput
app/routes/               endpoint HTTP: auth, profile, files, bench
tests/                    pytest: unit test + test end-to-end API
```

## Alur enkripsi singkat
- **Kunci:** `K_alg = HKDF-SHA256(SERVER_SECRET, salt=username, info="vault|"+alg)`. Hasilnya 32 byte untuk AES-256, 8 byte untuk DES, 16 byte untuk RC4, ditambah 32 byte kunci HMAC.
- **AES & DES:** mode **CTR**. IV acak sepanjang satu blok (16 / 8 byte) per data dan dipakai sebagai counter awal.
- **RC4:** nonce acak 16 byte per data. Kunci per data dihitung sebagai `SHA-256(K_rc4 ‖ nonce)[:16]`, lalu 3072 byte pertama keystream dibuang.
- **Integritas:** `HMAC-SHA256(K_mac, alg ‖ iv ‖ aad ‖ ciphertext)`. `aad` adalah ID record. HMAC diverifikasi **sebelum** data didekripsi dan dikirim ke user.

## API
Semua endpoint ada di bawah `/api`. Autentikasi memakai cookie `vault_session` (HttpOnly). Error dikembalikan sebagai `{"error": "..."}`. Parameter `alg` bernilai `AES`, `DES`, atau `RC4` (default `AES`).

| Method & path | Keterangan |
|---|---|
| `POST /auth/register` `{username, password}` | daftar dan langsung login (201) |
| `POST /auth/login` `{username, password}` | login (200) |
| `POST /auth/logout` | logout (204) |
| `GET /auth/me` | user aktif (401 kalau belum login) |
| `GET /auth/session` | `{"user": {...}}` atau `{"user": null}`, selalu 200 |
| `PUT /profile` `{full_name, nik, …}` | simpan profil, dienkripsi 3× |
| `GET /profile?alg=` | profil terdekripsi + waktu dekripsi + ciphertext (hex) |
| `POST /files` multipart `category`, `file` | upload, dienkripsi 3× (201) |
| `GET /files?category=` | daftar file (nama file didekripsi) |
| `GET /files/{id}/download?alg=` | verifikasi HMAC, lalu stream file terdekripsi |
| `GET /files/{id}/analysis` | perbandingan 3 ciphertext: entropi, ukuran, hex, HMAC |
| `POST /files/{id}/benchmark` `{runs}` | dekripsi N kali (1–50) per algoritma, plus statistik |
| `DELETE /files/{id}` | hapus row + 3 file `.enc` |
| `GET /benchmarks` | ringkasan semua pengukuran |
| `GET /benchmarks/raw` | data mentah (untuk export CSV) |
| `POST /benchmarks` `{file_id, algorithm, durations_ns}` | simpan waktu download yang diukur di browser |
| `DELETE /benchmarks` | hapus riwayat benchmark |

Kategori upload:

| Kategori | Format | Maks |
|---|---|---|
| `id_card` | jpg/jpeg/png | 5 MB |
| `document` | pdf/doc/docx/xls/xlsx | 20 MB |
| `video` | mp4/webm/mkv | 200 MB |

Kode status yang perlu diketahui:

| Status | Arti |
|---|---|
| `401` | belum login |
| `404` | file tidak ada atau bukan milik user (sengaja tidak dibedakan) |
| `413` | file terlalu besar |
| `415` | format tidak didukung atau isi tidak cocok dengan ekstensi |
| `422` | HMAC tidak cocok (data rusak atau dimodifikasi) |

## Test
```bash
pytest                                  # unit test (crypto, filetype, stats)
VAULT_TEST=1 pytest -v                  # + test end-to-end API (butuh MariaDB & .env)
```
Cakupan test end-to-end:
- register, login, dan logout
- validasi profil
- upload semua format; download dengan ketiga algoritma harus menghasilkan `sha256` yang sama dengan file asli
- tidak ada plaintext di DB maupun di disk
- IDOR (user lain mendapat 404)
- tamper: ubah 1 byte file atau baris DB, hasilnya harus 422
- upload yang ditolak (400/413/415)
- analisis, benchmark, dan hapus file

Test kripto juga mencocokkan hasil dengan test vector resmi: NIST SP 800-38A untuk AES-CTR dan RFC 5869 untuk HKDF.

## Benchmark untuk laporan
```bash
python bench.py --runs 30 --sizes 1KB,100KB,1MB,10MB,100MB --out ../report
```
Hasilnya:

| File | Isi |
|---|---|
| `bench_raw.csv` | semua pengukuran (ns) per algoritma, ukuran, operasi, dan run |
| `bench_summary.csv` | mean, median, stddev, min, max, throughput MB/s |
| `cipher_analysis.csv` | entropi plaintext vs ciphertext (data nol, teks, acak), efek bit-flip, jarak Hamming dengan IV baru, dan pembanding ECB (tidak dipakai aplikasi) |

Yang diukur hanya cipher-nya: membuat objek cipher (key schedule, RC4 drop) ditambah XOR keystream. I/O dan HMAC tidak ikut diukur, karena biayanya sama untuk ketiga algoritma.
