import io
import os

import pytest
from Crypto.Cipher import ARC4, DES

from app.crypto import (
    ALGORITHMS,
    CHUNK_SIZE,
    IV_SIZE,
    KEY_SIZE,
    MAC_SIZE,
    RC4_DROP,
    SECRET_SIZE,
    AuthError,
    Keys,
    hamming_distance,
    new_iv,
    parse_algorithm,
    rc4_record_key,
    shannon_entropy,
)

SECRET = b"\x42" * SECRET_SIZE


def keys(user: str = "alice") -> Keys:
    return Keys(SECRET, user)


def keys_with(alg: str, key: bytes) -> Keys:
    """A Keys object whose key for alg is fixed (for known-answer tests)."""
    k = keys()
    k._enc[alg] = key
    return k


def test_derive_keys():
    with pytest.raises(ValueError):
        Keys(SECRET[:-1], "alice")
    with pytest.raises(ValueError):
        Keys(SECRET, "")
    a1, a2, b = keys("alice"), keys("alice"), keys("bob")
    for alg in ALGORITHMS:
        assert len(a1._enc[alg]) == KEY_SIZE[alg]
        assert a1._enc[alg] == a2._enc[alg], "not deterministic"
        assert a1._enc[alg] != b._enc[alg], "same key for different users"
    assert a1._enc["AES"][:8] != a1._enc["DES"], "DES key is a prefix of the AES key"
    assert a1._mac != b._mac


def test_parse_algorithm():
    assert parse_algorithm("aes") == "AES"
    assert parse_algorithm(" DES ") == "DES"
    assert parse_algorithm("Rc4") == "RC4"
    for bad in ("", "ECB", "3DES", "aes-256"):
        with pytest.raises(ValueError):
            parse_algorithm(bad)


# Sizes around block boundaries (8 for DES, 16 for AES) and the chunk size.
SIZES = [0, 1, 7, 8, 9, 15, 16, 17, 1000, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, 3 * CHUNK_SIZE + 5]


@pytest.mark.parametrize("alg", ALGORITHMS)
@pytest.mark.parametrize("n", SIZES)
def test_round_trip(alg, n):
    k = keys()
    pt = os.urandom(n)
    sealed, ct = k.seal(alg, pt, b"file-123")
    assert len(ct) == n, "CTR/RC4 add no padding"
    assert len(sealed.iv) == IV_SIZE[alg] and len(sealed.mac) == MAC_SIZE
    assert sealed.stats.bytes == n
    if n >= 16:
        assert ct != pt
    got, _ = k.open(alg, sealed.iv, ct, sealed.mac, b"file-123")
    assert got == pt


class SmallReader(io.RawIOBase):
    """Returns at most 3 bytes per read, to exercise chunking."""

    def __init__(self, data: bytes):
        self._b = io.BytesIO(data)

    def read(self, n=-1):
        return self._b.read(min(3, n) if n and n > 0 else 3)


@pytest.mark.parametrize("alg", ALGORITHMS)
def test_streaming_short_reads(alg):
    k = keys()
    pt = os.urandom(4099)
    ct = io.BytesIO()
    sealed = k.encrypt(alg, SmallReader(pt), ct, b"")
    k.verify(alg, sealed.iv, sealed.mac, b"", SmallReader(ct.getvalue()))
    out = io.BytesIO()
    k.decrypt(alg, sealed.iv, SmallReader(ct.getvalue()), out)
    assert out.getvalue() == pt


@pytest.mark.parametrize("alg", ALGORITHMS)
def test_fresh_iv_per_encryption(alg):
    k = keys()
    pt = b"same plaintext " * 100
    s1, c1 = k.seal(alg, pt, b"")
    s2, c2 = k.seal(alg, pt, b"")
    assert s1.iv != s2.iv
    assert c1 != c2


def flip(b: bytes, i: int) -> bytes:
    c = bytearray(b)
    c[i] ^= 0x01
    return bytes(c)


@pytest.mark.parametrize("alg", ALGORITHMS)
def test_tamper_detection(alg):
    k = keys()
    pt = os.urandom(100)
    aad = b"file-1"
    s, ct = k.seal(alg, pt, aad)
    other = "RC4" if alg == "AES" else "AES"
    cases = {
        "ciphertext bit": lambda: k.open(alg, s.iv, flip(ct, 50), s.mac, aad),
        "truncated": lambda: k.open(alg, s.iv, ct[:99], s.mac, aad),
        "iv bit": lambda: k.open(alg, flip(s.iv, 0), ct, s.mac, aad),
        "mac bit": lambda: k.open(alg, s.iv, ct, flip(s.mac, 31), aad),
        "aad": lambda: k.open(alg, s.iv, ct, s.mac, b"file-2"),
        "other user": lambda: keys("bob").open(alg, s.iv, ct, s.mac, aad),
        "other alg": lambda: k.open(other, s.iv, ct, s.mac, aad),
    }
    for name, fn in cases.items():
        with pytest.raises(AuthError):
            fn()
            pytest.fail(f"{name}: tampering not detected")  # only reached if fn() did not raise


@pytest.mark.parametrize("alg", ALGORITHMS)
def test_bit_flip_no_diffusion(alg):
    """Documents the malleability that makes the HMAC necessary: with the
    same key and IV, one flipped plaintext bit flips exactly one
    ciphertext bit."""
    k = keys()
    pt = os.urandom(4096)
    pt2 = bytearray(pt)
    pt2[1234] ^= 0x10
    iv = new_iv(alg)
    c1 = k.cipher(alg, iv).encrypt(pt)
    c2 = k.cipher(alg, iv).encrypt(bytes(pt2))
    assert hamming_distance(c1, c2) == 1


def test_aes_ctr_known_answer():
    """NIST SP 800-38A, F.5.5 CTR-AES256.Encrypt."""
    k = keys_with("AES", bytes.fromhex("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4"))
    iv = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff")
    pt = bytes.fromhex("6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51")
    want = bytes.fromhex("601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c5")
    assert k.cipher("AES", iv).encrypt(pt) == want


def test_hkdf_known_answer():
    """RFC 5869 test case 1 (HKDF-SHA256), through the same library call."""
    from Crypto.Hash import SHA256
    from Crypto.Protocol.KDF import HKDF

    okm = HKDF(b"\x0b" * 22, 42, bytes(range(13)), SHA256, context=bytes(range(0xF0, 0xFA)))
    assert okm.hex() == (
        "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
    )


def test_des_ctr_matches_manual_counter():
    """DES-CTR equals counter mode built by hand from raw DES block
    encryptions of IV, IV+1, IV+2, ... (big-endian, carry across bytes)."""
    key = os.urandom(8)
    iv = bytes([0, 0, 0, 0, 0, 0, 0xFF, 0xFE])
    pt = os.urandom(8 * 5 + 3)
    got = keys_with("DES", key).cipher("DES", iv).encrypt(pt)

    block = DES.new(key, DES.MODE_ECB)
    ctr = int.from_bytes(iv, "big")
    want = bytearray()
    for off in range(0, len(pt), 8):
        ks = block.encrypt(ctr.to_bytes(8, "big"))
        want += bytes(a ^ b for a, b in zip(pt[off : off + 8], ks))
        ctr += 1
    assert got == bytes(want)


def test_rc4_drop_and_record_key():
    k = keys()
    nonce = new_iv("RC4")
    got = k.cipher("RC4", nonce).encrypt(bytes(64))
    # Raw RC4 keyed with SHA-256(K_rc4 || nonce)[:16], first 3072 bytes skipped.
    raw = ARC4.new(rc4_record_key(k._enc["RC4"], nonce)).encrypt(bytes(RC4_DROP + 64))
    assert got == raw[RC4_DROP:]
    # Different nonces must give unrelated keystreams under the same user key.
    assert k.cipher("RC4", new_iv("RC4")).encrypt(bytes(64)) != got


def test_cipher_rejects_bad_iv():
    k = keys()
    for alg in ALGORITHMS:
        with pytest.raises(ValueError):
            k.cipher(alg, bytes(IV_SIZE[alg] + 1))
    with pytest.raises(ValueError):
        k.cipher("ECB", b"")


def test_entropy():
    assert shannon_entropy(bytes([7]) * 1000) == 0
    assert shannon_entropy(bytes(range(256)) * 4) == 8
    assert shannon_entropy(b"") == 0
