"""Password hashing, credential validation and session tokens."""

import base64
import hashlib
import re
import secrets

import bcrypt

# Deliberately slow (~250 ms) so guessing leaked hashes offline is expensive.
BCRYPT_ROUNDS = 12

_USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")


def normalize_username(value: str) -> str:
    """The stored username is the HKDF salt, so it must be canonical:
    "Budi" and "budi" are the same user."""
    return (value or "").strip().lower()


def validate_username(username: str) -> str | None:
    if not _USERNAME_RE.match(username):
        return "username harus 3–32 karakter: huruf kecil, angka, atau underscore"
    return None


def validate_password(password: str) -> str | None:
    n = len(password.encode())
    if n < 8:
        return "password minimal 8 karakter"
    if n > 72:  # bcrypt only uses the first 72 bytes
        return "password maksimal 72 byte"
    return None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()


# Compared against when the username does not exist, so a failed login takes
# the same time whether or not the user exists.
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt(BCRYPT_ROUNDS))


def check_password(stored_hash: str | None, password: str) -> bool:
    """Pass stored_hash=None for an unknown user to burn the same bcrypt time."""
    try:
        if not stored_hash:
            bcrypt.checkpw(password.encode(), _DUMMY_HASH)
            return False
        return bcrypt.checkpw(password.encode(), stored_hash.encode())
    except ValueError:  # e.g. password longer than 72 bytes
        return False


def new_session_token() -> tuple[str, bytes]:
    """Returns a random token for the cookie and its SHA-256 for the
    database. A leaked sessions table cannot be replayed."""
    token = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    return token, hash_token(token)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
