# Assignment 2 — Arsitektur Key Management

Dokumen ini menjelaskan rancangan fitur. Implementasi belum dilakukan. Untuk pekerjaan paralel, baca [pembagian tugas dan prompt empat agent](PANDUAN_AGENT_ASSIGNMENT_2.md). **Sumber utama detail implementasi** adalah [kontrak sharing](KONTRAK_SHARING_ASSIGNMENT_2.md): gunakan endpoint, format, skema dan fungsi di sana jika ada perbedaan.

## Kondisi project saat ini

Data profil, gambar, dan dokumen disimpan sebagai item terenkripsi. `backend/app/crypto_services/envelope.py` membuat kunci data secara acak untuk setiap ciphertext. `keyring.py` menurunkan KEK simetris server dari `ROOT_KEY`. DEK dibungkus dengan KEK dan disimpan bersama metadata ciphertext; ciphertext file berada di `storage/`, sedangkan teks berada di database.

Konfigurasi default membuat ciphertext AES, DES, dan RC4 masing-masing dengan kunci sendiri. Untuk versi AES, paket kunci terdiri dari **32 byte kunci AES dan 32 byte kunci HMAC**. Saat ini server memeriksa akses lalu membuka data dan mengirim plaintext; belum ada alur berbagi DEK dengan RSA antaruser.

## Keputusan untuk assignment 2

Setiap user yang menerima data membuat pasangan RSA. Public key disimpan di server; private key dibuat dan disimpan dalam file terlindungi di perangkat user. Ketika penerima meminta akses dan pemilik menyetujui:

1. Server membuka DEK AES existing menggunakan KEK server.
2. Server mengenkripsi DEK yang sama dengan public key RSA penerima.
3. Pemilik mengunduh DEK terenkripsi dan mengirimnya lewat WA/email.
4. Penerima mengambil ciphertext AES dan metadata melalui aplikasi, lalu membuka DEK dengan private key di browser.
5. Browser memverifikasi HMAC dan membuka data menggunakan DEK.

```text
Data ── DEK existing ──> ciphertext ────────────────────> penerima
           │
           ├── KEK server ──> DEK terenkripsi di database
           └── public key penerima ──> DEK terenkripsi ──> WA/email
                                                              │
                               private key penerima membuka DEK ┘
```

Gunakan RSA-OAEP 2048-bit dengan SHA-256, dan gunakan hanya ciphertext AES existing dalam fitur ini. Setiap item memiliki DEK sendiri. Tidak perlu enkripsi ulang file ketika pertama kali dibagikan.

**Interpretasi tugas:** DEK dibuat ketika data disimpan dan digunakan kembali saat berbagi. Tidak ada symmetric key baru yang dibuat saat persetujuan. Cantumkan hal ini dalam laporan dan pastikan interpretasinya dapat diterima dosen.

## Cakupan

Fitur minimum meliputi pembuatan key pair, permintaan dan persetujuan/penolakan, pembungkusan DEK dengan public key, distribusi manual di luar aplikasi, serta pembukaan teks, gambar, dan dokumen oleh penerima. Tidak wajib membuat unit test baru; kelompok melakukan percobaan manual dan menjalankan pemeriksaan yang sudah ada bila memungkinkan.

Server masih dapat membaca DEK karena memegang KEK server. Private key dan DEK plaintext tidak dikirim ke server sebagai bagian alur baru atau dicatat di log. Tidak ada fitur pencabutan, rotasi key, atau pengiriman pesan otomatis dalam cakupan minimum. Data yang telah disimpan penerima tidak dapat ditarik kembali.

Pembagian: anggota 1 mengerjakan akses backend, anggota 2 RSA per user, anggota 3 enkripsi backend dan dekripsi data untuk sharing, dan anggota 4 frontend. Detail, batas file, kontrak antarmuka, serta percobaan akhir ada di kedua panduan yang ditautkan di atas.
