"""The caller's own provider API keys. Stored encrypted; only the last four characters are
ever returned."""

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, SecretStr
from sqlalchemy import delete, select

from app.deps import CurrentUser, DbSession
from app.models import Provider, ProviderKey
from app.services import crypto

router = APIRouter(prefix="/api/settings", tags=["settings"])


class KeyIn(BaseModel):
    api_key: SecretStr = Field(min_length=8, max_length=400)


class KeyOut(BaseModel):
    provider: Provider
    last4: str


@router.get("/keys", response_model=list[KeyOut])
async def list_keys(user: CurrentUser, db: DbSession) -> list[KeyOut]:
    rows = await db.scalars(
        select(ProviderKey).where(ProviderKey.user_id == user.id).order_by(ProviderKey.provider)
    )
    return [KeyOut(provider=row.provider, last4=row.last4) for row in rows]


@router.put("/keys/{provider}", response_model=KeyOut)
async def put_key(provider: Provider, body: KeyIn, user: CurrentUser, db: DbSession) -> KeyOut:
    secret = body.api_key.get_secret_value().strip()
    ciphertext, nonce = crypto.encrypt(secret, user.id, provider)
    await db.execute(
        delete(ProviderKey).where(ProviderKey.user_id == user.id, ProviderKey.provider == provider)
    )
    db.add(
        ProviderKey(
            user_id=user.id,
            provider=provider,
            ciphertext=ciphertext,
            nonce=nonce,
            last4=secret[-4:],
        )
    )
    await db.commit()
    return KeyOut(provider=provider, last4=secret[-4:])


@router.delete("/keys/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_key(provider: Provider, user: CurrentUser, db: DbSession) -> None:
    result = await db.execute(
        delete(ProviderKey).where(ProviderKey.user_id == user.id, ProviderKey.provider == provider)
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No key stored for that provider")
    await db.commit()
