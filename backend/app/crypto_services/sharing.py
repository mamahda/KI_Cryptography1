"""Rewrap the existing AES/HMAC data keys for an RSA recipient."""

from Crypto.Cipher import PKCS1_OAEP
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA

from .aes256_ctr_hmac import ENC_KEY_LEN, MAC_KEY_LEN
from .envelope import SealedCiphertext
from .errors import CryptoError
from .service import CryptoService


def wrap_existing_aes_keys(
    *, crypto: CryptoService, sealed: SealedCiphertext,
    item_id: str, public_key_spki_der: bytes,
) -> bytes:
    """Return RSA-OAEP-SHA256 ciphertext of the existing AES||HMAC keys.

    The caller must authorize the item, verify that ``sealed`` came from its
    AES ciphertext row, and store only the returned ciphertext. No new DEK is
    generated and no key bytes are returned to the router.
    """
    if sealed.cipher != "aes" or not item_id:
        raise CryptoError("Hanya kunci ciphertext AES yang dapat dibagikan")
    try:
        public_key = RSA.import_key(public_key_spki_der)
        if (public_key.has_private() or public_key.size_in_bits() != 2048
                or public_key.e != 65537):
            raise ValueError("Public key RSA tidak sesuai kontrak")
    except (ValueError, TypeError, IndexError) as exc:
        raise CryptoError("Public key penerima tidak valid") from exc

    keys = crypto.unwrap_aes_keys_for_sharing(sealed, context=item_id)
    if len(keys) != ENC_KEY_LEN + MAC_KEY_LEN:
        raise CryptoError("Panjang kunci AES/HMAC tidak valid")
    return PKCS1_OAEP.new(public_key, hashAlgo=SHA256).encrypt(keys)
