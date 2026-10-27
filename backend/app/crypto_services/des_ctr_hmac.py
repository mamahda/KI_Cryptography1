"""DES mode CTR + HMAC-SHA256 (encrypt-then-MAC).

Kunci data: 8 byte untuk DES + 32 byte untuk HMAC. Blok DES 8 byte, jadi nonce
4 byte + counter 32 bit (cukup untuk 32 GiB per pesan). DES (56-bit) dipakai
sesuai kebutuhan perbandingan metode, bukan karena kuat.
"""

import secrets

from Crypto.Cipher import DES

from ._mac import compute_tag, verify_tag
from .base import CipherSuite, EncryptedPayload

NAME = "des"
ENC_KEY_LEN = 8
MAC_KEY_LEN = 32
NONCE_LEN = 4


def encrypt(
    plaintext: bytes, enc_key: bytes, mac_key: bytes, aad: bytes = b""
) -> EncryptedPayload:
    nonce = secrets.token_bytes(NONCE_LEN)
    cipher = DES.new(enc_key, DES.MODE_CTR, nonce=nonce)
    ciphertext = cipher.encrypt(plaintext)
    return EncryptedPayload(nonce, ciphertext, compute_tag(mac_key, aad, nonce, ciphertext))


def decrypt(
    payload: EncryptedPayload, enc_key: bytes, mac_key: bytes, aad: bytes = b""
) -> bytes:
    verify_tag(mac_key, aad, payload.nonce, payload.ciphertext, payload.tag)
    cipher = DES.new(enc_key, DES.MODE_CTR, nonce=payload.nonce)
    return cipher.decrypt(payload.ciphertext)


SUITE = CipherSuite(NAME, ENC_KEY_LEN, MAC_KEY_LEN, encrypt, decrypt)
