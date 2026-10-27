"""Baca/tulis `items` + `ciphertexts` untuk field teks (storage='db').

SEMENTARA: data disimpan apa adanya (plain text) di kolom `blob`, bukan
dienkripsi. Tabel `ciphertexts` tetap butuh satu baris per cipher (aes/des/
rc4) sesuai skema di migration, jadi tiga baris itu untuk sekarang berisi
teks yang sama. Tim kripto akan mengganti isi `blob`/`nonce`/dst dengan
ciphertext dan kunci sungguhan nanti — bentuk tabelnya sudah sesuai.

Satu item aktif per (pemilik, field) — menulis field yang sudah ada akan
men-shred item lama dulu (lihat index unik parsial di migration 001).
"""

import sqlite3
from uuid import uuid4

CIPHERS = ("aes", "des", "rc4")


def write_item(
    db: sqlite3.Connection,
    *,
    field: str,
    plaintext: bytes,
    owner_user_id: str | None = None,
    owner_team_id: str | None = None,
) -> str:
    assert (owner_user_id is None) != (owner_team_id is None), "owner harus salah satu"

    owner_column = "owner_user_id" if owner_user_id is not None else "owner_team_id"
    owner_value = owner_user_id if owner_user_id is not None else owner_team_id

    db.execute(
        f"UPDATE items SET shredded_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') "
        f"WHERE {owner_column} = ? AND field = ? AND shredded_at IS NULL",
        (owner_value, field),
    )

    item_id = str(uuid4())
    db.execute(
        f"INSERT INTO items (id, {owner_column}, field, storage, size_bytes) "
        f"VALUES (?, ?, ?, 'db', ?)",
        (item_id, owner_value, field, len(plaintext)),
    )
    for cipher in CIPHERS:
        db.execute(
            """INSERT INTO ciphertexts
                   (id, item_id, cipher, nonce, wrap_nonce, wrapped_keys, wrap_tag, hmac_tag, blob)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                str(uuid4()),
                item_id,
                cipher,
                None if cipher == "rc4" else b"\x00" * 8,
                b"\x00" * 12,
                b"\x00",
                b"\x00" * 16,
                b"\x00" * 32,
                plaintext,
            ),
        )
    return item_id


def read_item(
    db: sqlite3.Connection,
    *,
    field: str,
    owner_user_id: str | None = None,
    owner_team_id: str | None = None,
) -> bytes | None:
    assert (owner_user_id is None) != (owner_team_id is None), "owner harus salah satu"

    owner_column = "owner_user_id" if owner_user_id is not None else "owner_team_id"
    owner_value = owner_user_id if owner_user_id is not None else owner_team_id

    item = db.execute(
        f"SELECT id FROM items WHERE {owner_column} = ? AND field = ? AND shredded_at IS NULL",
        (owner_value, field),
    ).fetchone()
    if item is None:
        return None

    row = db.execute(
        "SELECT blob FROM ciphertexts WHERE item_id = ? LIMIT 1", (item["id"],)
    ).fetchone()
    return row["blob"]
