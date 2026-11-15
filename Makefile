.PHONY: up down dev db migrate test test-backend test-sync test-frontend lint licences secrets-check seed

up:
	docker compose up --build

down:
	docker compose down

db:
	docker compose up -d db

migrate: db
	cd backend && uv run alembic upgrade head

# Local dev with reload: db in docker, the rest on the host (run each in its own terminal, or use `make -j3 dev`)
dev: db dev-api dev-sync dev-web
dev-api:
	cd backend && uv run alembic upgrade head && uv run uvicorn app.main:app --reload --port 8000
dev-sync:
	cd sync && npm run dev
dev-web:
	cd frontend && pnpm dev

test: test-backend test-sync test-frontend
test-backend: db
	cd backend && uv run pytest -q
test-sync:
	cd sync && npm test
test-frontend:
	cd frontend && pnpm test

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd sync && npx tsc --noEmit
	cd frontend && pnpm lint && pnpm exec tsc --noEmit
	$(MAKE) --no-print-directory secrets-check

# Fails on key-shaped strings or private key headers in tracked files / git history, and on
# tracked .env or key files. Fake fixtures: `# fake-secret-ok` on the line or .secrets-allowlist.
secrets-check:
	python3 scripts/secrets_check.py

licences:
	cd frontend && node scripts/check-licences.mjs
	cd sync && node ../frontend/scripts/check-licences.mjs

# Demo users, workspace, sample doc and sheet, on the running compose stack:  make seed SEED_PASSWORD=...
seed:
	docker compose exec -e SEED_PASSWORD -e API_ORIGIN=http://api:8000 -e SYNC_URL=ws://localhost:1234 sync node --import tsx scripts/seed.ts
