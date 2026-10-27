"""AES-256 mode CTR + HMAC-SHA256 (encrypt-then-MAC).

Kunci data: 32 byte untuk AES + 32 byte untuk HMAC (dibuat acak per ciphertext
oleh lapisan envelope, bukan di sini). Nonce 12 byte + counter 32 bit.
"""

import secrets

from Crypto.Cipher import AES

from ._mac import compute_tag, verify_tag
from .base import CipherSuite, EncryptedPayload

NAME = "aes"
ENC_KEY_LEN = 32
MAC_KEY_LEN = 32
NONCE_LEN = 12


def encrypt(
    plaintext: bytes, enc_key: bytes, mac_key: bytes, aad: bytes = b""
) -> EncryptedPayload:
    nonce = secrets.token_bytes(NONCE_LEN)
    cipher = AES.new(enc_key, AES.MODE_CTR, nonce=nonce)
    ciphertext = cipher.encrypt(plaintext)
    return EncryptedPayload(nonce, ciphertext, compute_tag(mac_key, aad, nonce, ciphertext))


def decrypt(
    payload: EncryptedPayload, enc_key: bytes, mac_key: bytes, aad: bytes = b""
) -> bytes:
    # Verifikasi HMAC dulu; ciphertext yang diubah tidak pernah didekripsi.
    verify_tag(mac_key, aad, payload.nonce, payload.ciphertext, payload.tag)
    cipher = AES.new(enc_key, AES.MODE_CTR, nonce=payload.nonce)
    return cipher.decrypt(payload.ciphertext)


SUITE = CipherSuite(NAME, ENC_KEY_LEN, MAC_KEY_LEN, encrypt, decrypt)
