#!/usr/bin/env python3
"""wallet-worker: settles pending transfers, each in one database transaction.

Several workers can run at once: FOR UPDATE SKIP LOCKED gives each transfer to
exactly one of them, and the transaction makes each settlement all-or-nothing.
"""
import os
import signal
import sys
import time

import psycopg

import db

INTERVAL = float(os.environ.get("POLL_SECONDS", "1"))
running = True


def stop(signum, frame):
    global running
    print("wallet-worker: got SIGTERM, finishing current batch", file=sys.stderr, flush=True)
    running = False


def settle_batch(conn) -> int:
    done = 0
    with conn.transaction():
        rows = conn.execute(
            "SELECT id, src, dst, amount FROM transfers WHERE status='pending' "
            "ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED").fetchall()
        for tid, src, dst, amount in rows:
            debited = conn.execute(
                "UPDATE accounts SET balance = balance - %s WHERE name=%s AND balance >= %s",
                (amount, src, amount)).rowcount
            if debited:
                conn.execute("UPDATE accounts SET balance = balance + %s WHERE name=%s", (amount, dst))
                status = "settled"
            else:
                status = "rejected"  # insufficient funds
            conn.execute("UPDATE transfers SET status=%s, settled_at=now() WHERE id=%s", (status, tid))
            print(f"wallet-worker: transfer {tid} {status}", file=sys.stderr, flush=True)
            done += 1
    return done


def main():
    signal.signal(signal.SIGTERM, stop)
    conn = db.connect()
    db.init_schema(conn)
    print(f"wallet-worker pid={os.getpid()} polling every {INTERVAL}s", file=sys.stderr, flush=True)
    while running:
        try:
            if settle_batch(conn) == 0:
                time.sleep(INTERVAL)
        except psycopg.OperationalError as e:
            print(f"wallet-worker: database error {e.__class__.__name__}, retrying", file=sys.stderr, flush=True)
            time.sleep(INTERVAL)
            conn = db.connect()
    print("wallet-worker: stopped cleanly", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
