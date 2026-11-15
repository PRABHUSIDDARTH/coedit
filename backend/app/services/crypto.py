"""AES-256-GCM for provider API keys.

One random 96-bit nonce per row. The row's owner and provider are bound in as associated
data, so a ciphertext copied onto another user's or provider's row will not decrypt.
"""

import base64
import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings
from app.models import Provider


class DecryptionError(Exception):
    """The stored key could not be decrypted (wrong master key or tampered row)."""


def _cipher() -> AESGCM:
    try:
        key = base64.b64decode(get_settings().key_encryption_key, validate=True)
    except ValueError:
        key = b""
    if len(key) != 32:
        raise ValueError("KEY_ENCRYPTION_KEY must be base64 of exactly 32 bytes")
    return AESGCM(key)


def _aad(user_id: uuid.UUID, provider: Provider) -> bytes:
    return f"{user_id}:{provider.value}".encode()


def encrypt(plaintext: str, user_id: uuid.UUID, provider: Provider) -> tuple[bytes, bytes]:
    """Return (ciphertext, nonce)."""
    nonce = os.urandom(12)
    return _cipher().encrypt(nonce, plaintext.encode(), _aad(user_id, provider)), nonce


def decrypt(ciphertext: bytes, nonce: bytes, user_id: uuid.UUID, provider: Provider) -> str:
    try:
        return _cipher().decrypt(nonce, ciphertext, _aad(user_id, provider)).decode()
    except InvalidTag:
        raise DecryptionError from None
