"""RC4 (stream cipher) murni: tanpa nonce dan tanpa HMAC.

Kunci data: 16 byte, acak per ciphertext. Karena tidak ada HMAC, RC4 tidak
mendeteksi perubahan ciphertext (bit-flipping lolos). Ini sifat metodenya;
keutuhan kuncinya saja yang dijaga oleh tag pembungkus (wrap_tag) di envelope.
"""

from Crypto.Cipher import ARC4

from .base import CipherSuite, EncryptedPayload

NAME = "rc4"
ENC_KEY_LEN = 16
MAC_KEY_LEN = 0


def encrypt(
    plaintext: bytes, enc_key: bytes, mac_key: bytes = b"", aad: bytes = b""
) -> EncryptedPayload:
    return EncryptedPayload(None, ARC4.new(enc_key).encrypt(plaintext), b"")


def decrypt(
    payload: EncryptedPayload, enc_key: bytes, mac_key: bytes = b"", aad: bytes = b""
) -> bytes:
    return ARC4.new(enc_key).decrypt(payload.ciphertext)


SUITE = CipherSuite(NAME, ENC_KEY_LEN, MAC_KEY_LEN, encrypt, decrypt)
