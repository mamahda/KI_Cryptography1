# Frontend — Secure Personal Data Vault

Aplikasi React + Vite (TypeScript) untuk backend Go di folder [`../backend`](../backend). Penjelasan keputusan desain ada di [`../TEAM.md`](../TEAM.md).

## Prasyarat
- Node.js ≥ 20
- Backend Go sudah berjalan (default `http://localhost:8080`). Cara menjalankannya ada di README backend.

## Menjalankan
```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
```
Dev server mem-proxy `/api` ke backend, jadi cookie session tetap satu origin. Kalau backend berjalan di alamat lain, jalankan dengan:
```bash
API_TARGET=http://localhost:9000 npm run dev
```

## Build produksi
```bash
npm run build          # hasil di dist/
```
`dist/` bisa di-serve langsung oleh backend: set `STATIC_DIR=../frontend/dist` di `backend/.env`, lalu buka `http://localhost:8080`.

## Perintah lain
| Perintah | Fungsi |
|---|---|
| `npm run lint` | oxlint |
| `npx tsc -b` | type-check (strict) |
| `npm run preview` | menjalankan hasil build dengan proxy `/api` yang sama |

## Halaman
| Route | Isi |
|---|---|
| `/login` | Masuk / Daftar (username + password) |
| `/` | Ringkasan jumlah data dan penjelasan singkat AES, DES, RC4 |
| `/profile` | Form data pribadi (UU PDP/GDPR), dienkripsi 3×. Panel kanan menampilkan hasil dekripsi per algoritma, waktu dekripsi, IV, HMAC, dan ciphertext (hex). |
| `/files` | Tab KTP / Dokumen / Video: upload dengan progress, waktu enkripsi tiap algoritma, unduh per algoritma, pratinjau KTP, hapus |
| `/files/:id` | Analisis ciphertext: ukuran, overhead, entropi, IV/nonce, HMAC, dan hex dari ketiga versi, dibandingkan dengan plaintext |
| `/benchmark` | Dekripsi berulang di server dan download berulang dari browser (N run). Menampilkan tabel statistik, grafik rata-rata, grafik per run, riwayat, dan ekspor CSV. |

## Struktur
```
src/lib/api.ts             client API bertipe + upload XHR (progress)
src/lib/auth-context.ts    context & hook useAuth
src/lib/format.ts          format ukuran/waktu/tanggal, aturan upload
src/lib/stats.ts           mean/median/stddev (sama dengan backend)
src/lib/chartTheme.ts      warna grafik dari token CSS (terang/gelap)
src/components/            Layout, AuthProvider, komponen UI, grafik benchmark
src/pages/                 satu file per halaman
src/index.css              token warna (terang & gelap) + seluruh style
```
Warna AES / DES / RC4 selalu sama di semua halaman: biru / oranye / hijau tosca. Data-nya tetap selalu disertai label teks, jadi warna bukan satu-satunya penanda.
