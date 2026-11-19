"""Database helpers shared by the API and the worker."""
import os
import time

import psycopg

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://wallet:wallet@localhost:5432/wallet")

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    name     TEXT PRIMARY KEY,
    balance  BIGINT NOT NULL CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS transfers (
    id         TEXT PRIMARY KEY,               -- client-chosen idempotency key
    src        TEXT NOT NULL REFERENCES accounts(name),
    dst        TEXT NOT NULL REFERENCES accounts(name),
    amount     BIGINT NOT NULL CHECK (amount > 0),
    status     TEXT NOT NULL DEFAULT 'pending', -- pending | settled | rejected
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ
);
"""


def connect(retries: int = 30):
    """Connect, waiting for Postgres to come up (it often starts after us)."""
    for attempt in range(retries):
        try:
            return psycopg.connect(DATABASE_URL, autocommit=True)
        except psycopg.OperationalError:
            if attempt == retries - 1:
                raise
            time.sleep(1)


def init_schema(conn) -> None:
    conn.execute(SCHEMA)
