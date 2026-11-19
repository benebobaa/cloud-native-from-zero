# Wallet v1 — the running case study (Vol 3 onwards)

One image (`wallet:v1`), two programs, one database:

| Part | File | Does |
|---|---|---|
| wallet-api | `app/api.py` | HTTP/JSON on :8080 — accounts, transfer requests (idempotent by `id`), `/healthz`, `/readyz`, `/metrics` |
| wallet-worker | `app/worker.py` | Settles pending transfers, each in one DB transaction (`FOR UPDATE SKIP LOCKED`, safe with many workers) |
| Postgres 17 | `compose.yaml` | Source of truth: tables `accounts`, `transfers` |

Config: `DATABASE_URL` (default `postgresql://wallet:wallet@localhost:5432/wallet`), `PORT` (8080), `POLL_SECONDS` (1).
Both programs handle SIGTERM gracefully. Runs as UID 10001.

```bash
docker compose up -d --build   # build wallet:v1, start postgres + api + worker
./test_e2e.sh                   # self-check: PASS expected
docker compose down -v
```

Tested 2026-11-16 (Docker Desktop on WSL2): `test_e2e.sh` PASS twice; worker stopped cleanly on SIGTERM; image 209 MB (Vol 4 shrinks it).
Vol 4 additions: `Dockerfile.slim`, `Dockerfile.alpine`, `Dockerfile.distroless` (smaller image variants), `measure_image.sh` (size comparison), `compose.stack.yaml` (Lab 4.3 stack with health checks, limits, restart policies; `test_e2e.sh` passes against it).

Wallet v0 (single file, JSON storage) lives inline in Lab 1.1 and is used in Vol 1–2.
