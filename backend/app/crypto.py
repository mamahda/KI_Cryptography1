"""The vault's encryption scheme.

- Per-user, per-algorithm keys derived with HKDF-SHA256 from the server
  secret, using the username as salt.
- AES-256-CTR, DES-CTR and RC4-drop[3072] keystreams.
- HMAC-SHA256 encrypt-then-MAC over algorithm, IV, associated data and
  ciphertext.
"""

import hashlib
import hmac
import io
import os
import time
from dataclasses import dataclass, field
from typing import BinaryIO, Iterator

import numpy as np
from Crypto.Cipher import AES, ARC4, DES
from Crypto.Hash import SHA256
from Crypto.Protocol.KDF import HKDF

ALGORITHMS = ("AES", "DES", "RC4")

# Bytes of key material derived per user, and of IV (CTR) or nonce (RC4)
# generated per record.
KEY_SIZE = {"AES": 32, "DES": 8, "RC4": 16}  # AES-256, DES (56-bit effective), RC4-128
IV_SIZE = {"AES": 16, "DES": 8, "RC4": 16}  # one full counter block; 128-bit RC4 nonce

SECRET_SIZE = 32  # minimum server secret length
MAC_SIZE = 32  # HMAC-SHA256 tag
RC4_DROP = 3072  # initial RC4 keystream bytes discarded (they are biased)
CHUNK_SIZE = 256 * 1024


class AuthError(Exception):
    """The HMAC did not match: ciphertext, IV, algorithm or associated data
    was modified or corrupted."""


def parse_algorithm(value: str) -> str:
    alg = (value or "").strip().upper()
    if alg not in ALGORITHMS:
        raise ValueError(f"unknown algorithm {value!r}")
    return alg


def new_iv(alg: str) -> bytes:
    return os.urandom(IV_SIZE[alg])


@dataclass
class Stats:
    bytes: int = 0
    cipher_ns: int = 0  # time inside the cipher only (setup + keystream XOR)
    total_ns: int = 0  # whole pass including I/O and HMAC


@dataclass
class Sealed:
    algorithm: str
    iv: bytes
    mac: bytes
    stats: Stats = field(default_factory=Stats)


def _field(m: "hmac.HMAC", data: bytes) -> None:
    m.update(len(data).to_bytes(4, "big"))
    m.update(data)


def rc4_record_key(key: bytes, nonce: bytes) -> bytes:
    """Gives every record its own RC4 key. RC4 has no IV, so without this all
    of a user's records would share one keystream and C1 xor C2 would equal
    P1 xor P2. Key and nonce are hashed rather than concatenated, because raw
    key||IV is what made WEP's RC4 breakable."""
    return hashlib.sha256(key + nonce).digest()[: KEY_SIZE["RC4"]]


class _TimedCipher:
    """Wraps a PyCryptodome cipher and adds up the time spent inside it, so
    cipher cost can be measured separately from disk I/O and HMAC."""

    def __init__(self, factory):
        start = time.perf_counter_ns()
        self._cipher = factory()  # key schedule (and RC4 drop) counts as cipher time
        self.ns = time.perf_counter_ns() - start

    def xor(self, data: bytes) -> bytes:
        start = time.perf_counter_ns()
        out = self._cipher.encrypt(data)  # CTR/RC4: encrypt == decrypt
        self.ns += time.perf_counter_ns() - start
        return out


class Keys:
    """One user's derived keys. Cheap to derive, so recomputed per request
    and never stored."""

    def __init__(self, secret: bytes, username: str):
        """K_alg = HKDF-SHA256(secret, salt=username, info="vault|"+alg)
        K_mac = HKDF-SHA256(secret, salt=username, info="vault|mac")

        Distinct info strings make the keys independent, so brute-forcing the
        56-bit DES key reveals nothing about the AES, RC4 or MAC keys."""
        if len(secret) < SECRET_SIZE:
            raise ValueError(f"server secret must be at least {SECRET_SIZE} bytes")
        if not username:
            raise ValueError("empty username")
        salt = username.encode()
        self._enc = {
            alg: HKDF(secret, KEY_SIZE[alg], salt, SHA256, context=f"vault|{alg}".encode()) for alg in ALGORITHMS
        }
        self._mac = HKDF(secret, MAC_SIZE, salt, SHA256, context=b"vault|mac")

    # --- keystreams -----------------------------------------------------

    def cipher(self, alg: str, iv: bytes):
        """Returns a PyCryptodome cipher object; .encrypt() XORs the keystream,
        so the same object type encrypts and decrypts."""
        if alg not in ALGORITHMS:
            raise ValueError(f"unknown algorithm {alg!r}")
        if len(iv) != IV_SIZE[alg]:
            raise ValueError(f"{alg} needs a {IV_SIZE[alg]}-byte IV, got {len(iv)}")
        key = self._enc[alg]
        if alg == "AES":
            # The whole 16-byte IV is the initial counter block.
            return AES.new(key, AES.MODE_CTR, nonce=b"", initial_value=iv)
        if alg == "DES":
            return DES.new(key, DES.MODE_CTR, nonce=b"", initial_value=iv)
        return ARC4.new(rc4_record_key(key, iv), drop=RC4_DROP)

    def _timed(self, alg: str, iv: bytes) -> _TimedCipher:
        return _TimedCipher(lambda: self.cipher(alg, iv))

    def _new_mac(self, alg: str, iv: bytes, aad: bytes) -> "hmac.HMAC":
        """HMAC-SHA256(K_mac, alg || iv || aad || ciphertext), each field
        length-prefixed so boundaries are unambiguous. aad binds the
        ciphertext to its record (e.g. the file ID), so ciphertexts cannot be
        swapped between records undetected."""
        m = hmac.new(self._mac, digestmod=hashlib.sha256)
        _field(m, alg.encode())
        _field(m, iv)
        _field(m, aad)
        return m

    # --- streaming ------------------------------------------------------

    def encrypt(self, alg: str, src: BinaryIO, dst: BinaryIO, aad: bytes) -> Sealed:
        """Streams src through alg with a fresh IV into dst."""
        start = time.perf_counter_ns()
        iv = new_iv(alg)
        c = self._timed(alg, iv)
        mac = self._new_mac(alg, iv, aad)
        size = 0
        while chunk := src.read(CHUNK_SIZE):
            ct = c.xor(chunk)
            mac.update(ct)
            dst.write(ct)
            size += len(ct)
        stats = Stats(bytes=size, cipher_ns=c.ns, total_ns=time.perf_counter_ns() - start)
        return Sealed(algorithm=alg, iv=iv, mac=mac.digest(), stats=stats)

    def verify(self, alg: str, iv: bytes, tag: bytes, aad: bytes, src: BinaryIO, observe=None) -> None:
        """Reads the whole ciphertext and checks its tag in constant time.
        observe(chunk), if given, sees every ciphertext chunk.
        Raises AuthError on mismatch."""
        if alg not in ALGORITHMS or len(iv) != IV_SIZE[alg]:
            raise AuthError("bad algorithm or IV")
        mac = self._new_mac(alg, iv, aad)
        while chunk := src.read(CHUNK_SIZE):
            mac.update(chunk)
            if observe:
                observe(chunk)
        if not hmac.compare_digest(mac.digest(), tag):
            raise AuthError("message authentication failed")

    def decrypt_chunks(self, alg: str, iv: bytes, src: BinaryIO, stats: Stats) -> Iterator[bytes]:
        """Yields plaintext chunks of the ciphertext in src and fills stats.
        Does not authenticate: callers must verify() the same data first."""
        start = time.perf_counter_ns()
        c = self._timed(alg, iv)
        while chunk := src.read(CHUNK_SIZE):
            pt = c.xor(chunk)
            stats.bytes += len(pt)
            stats.cipher_ns = c.ns
            yield pt
        stats.cipher_ns = c.ns
        stats.total_ns = time.perf_counter_ns() - start

    def decrypt(self, alg: str, iv: bytes, src: BinaryIO, dst: BinaryIO | None = None) -> Stats:
        """Decrypts src into dst (or discards it, for benchmarking)."""
        stats = Stats()
        for pt in self.decrypt_chunks(alg, iv, src, stats):
            if dst is not None:
                dst.write(pt)
        return stats

    # --- small in-memory values (profile JSON, filenames) ----------------

    def seal(self, alg: str, plaintext: bytes, aad: bytes) -> tuple[Sealed, bytes]:
        out = io.BytesIO()
        sealed = self.encrypt(alg, io.BytesIO(plaintext), out, aad)
        return sealed, out.getvalue()

    def open(self, alg: str, iv: bytes, ciphertext: bytes, tag: bytes, aad: bytes) -> tuple[bytes, Stats]:
        self.verify(alg, iv, tag, aad, io.BytesIO(ciphertext))
        out = io.BytesIO()
        stats = self.decrypt(alg, iv, io.BytesIO(ciphertext), out)
        return out.getvalue(), stats


# --- analysis helpers ------------------------------------------------------


class Entropy:
    """Accumulates a byte histogram so the Shannon entropy of large streams
    can be computed in one pass."""

    def __init__(self):
        self.counts = np.zeros(256, dtype=np.int64)
        self.n = 0

    def update(self, data: bytes) -> None:
        if data:
            self.counts += np.bincount(np.frombuffer(data, dtype=np.uint8), minlength=256)
            self.n += len(data)

    def bits(self) -> float:
        """Bits per byte: 0 for constant data, 8 for uniformly random data."""
        if self.n == 0:
            return 0.0
        p = self.counts[self.counts > 0] / self.n
        h = float(-(p * np.log2(p)).sum())
        return h if h > 0 else 0.0  # avoid printing -0.0 for constant data


def shannon_entropy(data: bytes) -> float:
    e = Entropy()
    e.update(data)
    return e.bits()


def hamming_distance(a: bytes, b: bytes) -> int:
    """Number of differing bits between equal-length a and b."""
    if len(a) != len(b):
        raise ValueError("hamming_distance on inputs of different length")
    return (int.from_bytes(a, "big") ^ int.from_bytes(b, "big")).bit_count()
