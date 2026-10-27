# API Backend — Schematics NIC

Semua endpoint berprefix `/api` (lihat `app/main.py`). Base URL contoh: `http://127.0.0.1:8000`.

## Konvensi umum

- **Sesi**: JWT di cookie HttpOnly `access_token` (set oleh `/auth/login`, berlaku 8 jam). Endpoint yang butuh login mensyaratkan cookie ini (dependency `get_current_user`).
- **CSRF**: setiap request yang mengubah data (POST/PUT/DELETE) wajib kirim header `X-CSRF-Token` berisi nilai cookie `csrf_token` (dependency `require_csrf`, double-submit). Cookie ini **bukan** HttpOnly, sengaja bisa dibaca JavaScript frontend.
- **Role**: `peserta`, `juri`, `superadmin`. Endpoint ber-role memakai dependency `require_roles(...)` → 403 jika role tidak cocok.
- **404 vs 403 untuk item**: endpoint yang membuka item/file (`GET /items/{item_id}`) selalu membalas 404 baik untuk item yang tidak ada maupun yang tidak boleh dibuka — supaya ID tidak bisa dipakai menebak keberadaan data (lihat README § Peran dan hak akses).
- **Error body**: `{"detail": "pesan"}` (bawaan FastAPI/`HTTPException`).
- **Upload file**: dikirim sebagai **raw request body** (bukan multipart), nama file asli dikirim lewat **query param `filename`** (ekstensinya dipakai untuk menentukan tipe file). Ekstensi tidak didukung → `415`; body kosong → `400`; melebihi batas ukuran → `413`.
- **Penyimpanan plaintext**: semua field dan file disimpan apa adanya, tanpa enkripsi — teks di kolom `items.value`, file di folder `storage/` (path-nya di `items.path`). Skema yang aktif adalah `app/db/migrations_before_crypto/`. Enkripsi dan benchmark bukan bagian backend ini.

---

## Auth — `/api/auth`

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/register` | - | `{email, password}` | 201 `{id, role, verification_status}` |
| POST | `/login` | - | `{email, password}` | 200 `{id, role, verification_status, must_change_password}` + set cookie sesi. Rate limit 10/menit/IP. Kalau `must_change_password` true (akun juri baru), frontend arahkan ke ganti password |
| POST | `/change-password` | sesi + CSRF | `{current_password, new_password}` | 204. Dipakai juri yang akun dibuat superadmin (`must_change_password`) atau peserta ganti password sendiri |
| POST | `/logout` | sesi + CSRF | - | 204 + hapus cookie sesi |
| GET | `/me` | sesi | - | 200 `{id, role, verification_status, must_change_password}` |

Error khas: `409` email sudah terdaftar (register), `401` email/password salah (login) atau password lama salah (change-password).

## Privacy — `/api/privacy`

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/notice` | - | - | 200 `{policy_version, policy_text}` |
| POST | `/consent` | sesi + CSRF | - | 204. Mencatat persetujuan peserta untuk `policy_version` aktif saat ini |

Endpoint `PUT /profile/me` dan `PUT /documents/{doc_type}` **menolak** (403) peserta yang belum consent ke versi aktif (dependency `require_consent`).

## Profile — `/api/profile`

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/me` | sesi | - | 200 `{email, full_name, nim, study_program, institution, birth_date, domicile, phone}` (null jika belum diisi) |
| PUT | `/me` | sesi (peserta) + CSRF + consent | subset field di atas (semua opsional) | 204 |

Mengubah `full_name`/`nim`/`institution` setelah status `terverifikasi` mengembalikan status peserta ke `menunggu`. `email` hanya dibaca di sini — perubahan email tidak ada di modul ini.

## Documents — `/api/documents`

| Method | Path | Auth | Query | Body | Response |
| --- | --- | --- | --- | --- | --- |
| PUT | `/{doc_type}` | sesi (peserta) + CSRF + consent | `filename` (wajib) | raw bytes, maks **5 MB**, ekstensi jpg/jpeg/png/pdf | 204 |

`doc_type` ∈ `ktp`, `ktm`, `twibbon`. Upload baru menggantikan dokumen lama (file lama dihapus dari `storage/`). Begitu ketiga dokumen ada, `verification_status` peserta menjadi `menunggu` (termasuk saat mengganti dokumen setelah diverifikasi/ditolak). Ditolak (`409`) jika tenggat pendaftaran (`deadline_at`) sudah lewat.

## Teams — `/api/teams`

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `` | sesi (peserta) + CSRF | `{team_name}` | 201 `TeamOut`. Pembuat jadi ketua |
| POST | `/join` | sesi (peserta) + CSRF | `{team_code}` | 200 `TeamOut`. Rate limit 10/menit/IP |
| POST | `/leave` | sesi (peserta) + CSRF | - | 204 |
| GET | `/me` | sesi | - | 200 `TeamOut` |
| DELETE | `/members/{user_id}` | sesi (ketua) + CSRF | - | 204 |

`TeamOut = {id, team_code, team_name, status, members: [{user_id, full_name, is_leader}]}`.

Aturan: satu peserta hanya satu tim; kode tim 8 karakter acak (alfabet tanpa karakter ambigu); batas anggota dibaca dinamis dari setting `max_team_members` (default 4); tim `final` tidak bisa diubah; ketua tidak bisa keluar sendiri selagi ada anggota lain (keluarkan anggota dulu) — keluar sebagai ketua saat tim hanya berisi dirinya akan **menghapus tim**.

## Items — Submission & File — `/api/items`

| Method | Path | Auth | Query | Body | Response |
| --- | --- | --- | --- | --- | --- |
| PUT | `/proposal` | sesi (ketua) + CSRF | `filename` | raw bytes, maks **10 MB**, ekstensi pdf | 204 |
| PUT | `/video` | sesi (ketua) + CSRF | `filename` | raw bytes, maks **100 MB**, ekstensi mp4 | 204 |
| PUT | `/repo-url` | sesi (ketua) + CSRF | - | `{repo_url}` (harus `https://github.com/...`) | 204 |
| POST | `/submit-final` | sesi (ketua) + CSRF | - | `{confirm: true}` | 204 |
| GET | `/{item_id}` | sesi | - | - | 200 (isi file, atau teks untuk item seperti `repo_url`) atau 404 |

Semua endpoint upload/`submit-final` ditolak `409` jika tim sudah `final` atau tenggat pengumpulan sudah lewat.

`POST /submit-final` memverifikasi sebelum mengubah status tim ke `final`:
- `confirm: true` wajib dikirim (konfirmasi dua langkah di sisi frontend).
- Tim berisi 2 sampai `max_team_members` anggota.
- **Semua** anggota sudah punya item aktif untuk: `full_name, nim, study_program, institution, birth_date, domicile, phone` (data diri) dan `ktp, ktm, twibbon` (dokumen).
- Tim punya item aktif `proposal`, `video`, `repo_url`.

`GET /{item_id}` — matriks akses (lihat juga README § Peran dan hak akses):

| Pengakses | Field dokumen pribadi (ktp/ktm/twibbon) | Field tim (proposal/video/repo_url) |
| --- | --- | --- |
| Pemilik sendiri | ✅ | — |
| Anggota tim yang sama | ❌ (404) | ✅ |
| Juri | ❌ (404) | ✅ **hanya** jika tim sudah `final`, tercatat di audit log |
| Superadmin | ✅, tercatat di audit log | ✅, tercatat di audit log |
| Lainnya | 404 | 404 |

## Judges — `/api/judges`

| Method | Path | Auth | Response |
| --- | --- | --- | --- |
| GET | `/teams` | sesi (role `juri`) | 200 `[{id, team_code, team_name}]` — semua tim `final`. Tercatat di audit log |
| GET | `/teams/{team_id}` | sesi (role `juri`) | 200 `{id, team_name, members: [{full_name, institution}], proposal_item_id, video_item_id, repo_url}`. 404 jika tim belum final. Tercatat di audit log |

`proposal_item_id`/`video_item_id` dipakai juri untuk `GET /items/{item_id}` (stream file-nya).

## Admin — `/api/admin` (role `superadmin`)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/participants` | - | 200 `[{id, email, verification_status, is_minor, team_id}]` |
| POST | `/participants/{user_id}/verify` | `{approve, reason}` (reason wajib) | 204. Set `verification_status` → `terverifikasi`/`ditolak`, catat ke `verification_events` + audit log. 409 kalau peserta masih `belum_lengkap` |
| POST | `/judges` | `{email, temporary_password}` | 201 `{id, email}`. Buat akun role `juri`, `must_change_password=1` |
| GET | `/settings` | - | 200 `{deadline_at, max_team_members, privacy_policy_version, privacy_policy_text}` |
| PUT | `/settings` | subset field di atas | 204. `deadline_at` harus tanggal-waktu ISO 8601 (tanpa zona waktu = jam server), `max_team_members` ≥ 2; selain itu 422. Dicatat audit log |
| GET | `/audit-logs` | query `limit` (≤500, default 100), `offset` | 200 `[{id, actor_id, action, item_id, subject_user_id, result, created_at}]`, terbaru dulu |

`is_minor` dihitung dari `birth_date` (true jika umur < 18 tahun saat dicek; null jika `birth_date` belum diisi).
