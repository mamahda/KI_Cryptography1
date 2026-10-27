"""RC4 (stream cipher) + HMAC-SHA256 (encrypt-then-MAC).

Kunci data: 16 byte untuk RC4 + 32 byte untuk HMAC, acak per ciphertext. RC4 tidak
memakai nonce (kolom `nonce` NULL); keunikan datang dari kunci acak per ciphertext.
HMAC mengautentikasi AAD + ciphertext, sehingga perubahan ciphertext terdeteksi
(RC4 sendiri rentan bit-flipping). RC4 dipakai sesuai kebutuhan perbandingan
metode; algoritmanya sendiri sudah dianggap lemah.
"""

from Crypto.Cipher import ARC4

from ._mac import compute_tag, verify_tag
from .base import CipherSuite, EncryptedPayload
from ._mac import compute_tag, verify_tag
from .errors import IntegrityError
from .timing import Timings, measure

NAME = "rc4"
ENC_KEY_LEN = 16
MAC_KEY_LEN = 32


def encrypt(
    plaintext: bytes, enc_key: bytes, mac_key: bytes, aad: bytes = b""
) -> EncryptedPayload:
    ciphertext = ARC4.new(enc_key).encrypt(plaintext)
    return EncryptedPayload(None, ciphertext, compute_tag(mac_key, aad, b"", ciphertext))


def decrypt(
    payload: EncryptedPayload, enc_key: bytes, mac_key: bytes, aad: bytes = b""
) -> bytes:
    verify_tag(mac_key, aad, b"", payload.ciphertext, payload.tag)
    return ARC4.new(enc_key).decrypt(payload.ciphertext)


SUITE = CipherSuite(NAME, ENC_KEY_LEN, MAC_KEY_LEN, encrypt, decrypt)
