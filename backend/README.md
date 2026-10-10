# Backend — Secure Personal Data Vault

REST API dalam Go yang menyimpan data pribadi, foto KTP, dokumen, dan video. Setiap data dienkripsi **tiga kali**, masing-masing dengan AES-256-CTR, DES-CTR, dan RC4-drop[3072]. Integritasnya dijaga dengan HMAC-SHA256. Penjelasan dan alasan setiap keputusan desain ada di [`../TEAM.md`](../TEAM.md).

## Prasyarat
- Go ≥ 1.24
- Docker + Docker Compose (untuk MySQL 8). Bisa juga memakai MySQL 8 atau MariaDB ≥ 10.6 yang sudah terpasang.

## Menjalankan
```bash
# dari root repo
docker compose up -d                     # MySQL di localhost:3307

cd backend
cp .env.example .env
# isi SERVER_SECRET di .env dengan hasil perintah ini:
openssl rand -hex 32

go run ./cmd/server                      # API di http://localhost:8080
```
Server membuat tabel secara otomatis saat start (`internal/db/schema.sql`) dan menyimpan ciphertext file di `../storage/`.

## Konfigurasi (`.env`)
| Variabel | Default | Keterangan |
|---|---|---|
| `DB_DSN` | `vault:vault@tcp(127.0.0.1:3307)/vault` | DSN go-sql-driver/mysql |
| `SERVER_SECRET` | — (wajib) | 32 byte hex, akar HKDF. **Jangan diganti atau hilang**, karena semua data lama tidak akan bisa didekripsi lagi. |
| `STORAGE_DIR` | `../storage` | lokasi file `.enc` |
| `HTTP_ADDR` | `:8080` | alamat listen |
| `COOKIE_SECURE` | `false` | `true` kalau server diakses lewat HTTPS |
| `SESSION_TTL` | `24h` | umur session |
| `STATIC_DIR` | — | opsional: folder `frontend/dist` untuk di-serve sekaligus oleh server ini |

## Struktur
```
cmd/server/          entry point HTTP server
cmd/bench/           benchmark CLI → CSV untuk laporan
internal/crypto/     HKDF, AES-CTR, DES-CTR, RC4-drop, HMAC, entropi
internal/api/        handler HTTP + integration test
internal/db/         query MySQL + schema.sql
internal/auth/       bcrypt, validasi kredensial, token session
internal/filetype/   validasi upload (ekstensi, magic bytes, ukuran)
internal/storage/    baca/tulis file .enc
internal/stats/      mean/median/stddev/throughput
```

## API
Semua endpoint ada di bawah `/api`. Autentikasi memakai cookie `vault_session` (HttpOnly). Error dikembalikan sebagai `{"error": "..."}`. Parameter `alg` bernilai `AES`, `DES`, atau `RC4` (default `AES`).

| Method & path | Keterangan |
|---|---|
| `POST /auth/register` `{username, password}` | daftar dan langsung login (201) |
| `POST /auth/login` `{username, password}` | login (200) |
| `POST /auth/logout` | logout (204) |
| `GET /auth/me` | user aktif |
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
go test ./... -race                       # unit test (crypto, filetype, stats)

# integration test end-to-end (butuh MySQL yang sedang jalan)
VAULT_TEST_DSN='vault:vault@tcp(127.0.0.1:3307)/vault' go test ./internal/api -v
```
Cakupan integration test:
- register, login, dan logout
- validasi profil
- upload semua format; download dengan ketiga algoritma harus menghasilkan `sha256` yang sama dengan file asli
- tidak ada plaintext di DB maupun di disk
- IDOR (user lain mendapat 404)
- tamper: ubah 1 byte file atau baris DB, hasilnya harus 422
- upload yang ditolak (400/413/415)
- analisis, benchmark, dan hapus file

## Benchmark untuk laporan
```bash
go run ./cmd/bench -runs 30 -sizes 1KB,100KB,1MB,10MB,100MB -out ../report
```
Hasilnya:

| File | Isi |
|---|---|
| `bench_raw.csv` | semua pengukuran (ns) per algoritma, ukuran, operasi, dan run |
| `bench_summary.csv` | mean, median, stddev, min, max, throughput MB/s |
| `cipher_analysis.csv` | entropi plaintext vs ciphertext (data nol, teks, acak), efek bit-flip, jarak Hamming dengan IV baru, dan pembanding ECB (tidak dipakai aplikasi) |

Yang diukur hanya cipher-nya: setup stream (key schedule, RC4 drop) ditambah XOR keystream. I/O dan HMAC tidak ikut diukur, karena biayanya sama untuk ketiga algoritma.
