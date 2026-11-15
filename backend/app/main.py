from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app import logging_redact
from app.config import get_settings
from app.council import pipeline
from app.db import engine
from app.deps import csrf_guard
from app.middleware import BodySizeLimitMiddleware
from app.routers import auth, blobs, council, files, folders, settings, tickets, workspaces

logging_redact.install()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await pipeline.fail_interrupted_runs()
    yield


app = FastAPI(title="coedit API", dependencies=[Depends(csrf_guard)], lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's default 422 body echoes the rejected input, which may be a password or an
    API key. Report where and why, never what."""
    detail = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse({"detail": detail}, status_code=422)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[get_settings().web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for _router in (
    auth.router,
    workspaces.router,
    folders.router,
    blobs.router,
    files.router,
    tickets.router,
    settings.router,
    council.router,
):
    app.include_router(_router)
app.add_middleware(BodySizeLimitMiddleware)


@app.get("/api/health")
async def health() -> dict[str, str]:
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))
    return {"status": "ok"}
