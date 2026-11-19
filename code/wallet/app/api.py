#!/usr/bin/env python3
"""wallet-api: accounts, transfer requests and balances over HTTP/JSON.

Endpoints
  GET  /healthz                 process is alive (no database check)
  GET  /readyz                  database reachable -> 200, else 503
  GET  /metrics                 Prometheus text format counters
  POST /accounts                {"name": "alice", "balance": 100}
  GET  /accounts/<name>         {"name": "alice", "balance": 100}
  POST /transfers               {"id": "t-1", "from": "alice", "to": "bob", "amount": 10} -> 202
  GET  /transfers/<id>          {"id": "t-1", "status": "settled", ...}
"""
import json
import os
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg

import db

PORT = int(os.environ.get("PORT", "8080"))
_local = threading.local()
_counts = {"requests_total": 0, "transfers_requested_total": 0, "errors_total": 0}
_lock = threading.Lock()


def conn():
    # One connection per server thread; psycopg connections are not thread-safe.
    c = getattr(_local, "conn", None)
    if c is None or c.closed:
        c = _local.conn = db.connect()
    return c


def count(key):
    with _lock:
        _counts[key] += 1


class Handler(BaseHTTPRequestHandler):
    server_version = "wallet-api/1"

    def reply(self, code, body):
        data = json.dumps(body).encode() + b"\n"
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self):
        count("requests_total")
        parts = self.path.strip("/").split("/")
        try:
            if parts == ["healthz"]:
                return self.reply(200, {"status": "ok"})
            if parts == ["readyz"]:
                conn().execute("SELECT 1")
                return self.reply(200, {"status": "ready"})
            if parts == ["metrics"]:
                with _lock:
                    text = "".join(f"wallet_api_{k} {v}\n" for k, v in _counts.items())
                data = text.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4")
                self.end_headers()
                return self.wfile.write(data)
            if len(parts) == 2 and parts[0] == "accounts":
                row = conn().execute("SELECT name, balance FROM accounts WHERE name=%s", (parts[1],)).fetchone()
                if not row:
                    return self.reply(404, {"error": "no such account"})
                return self.reply(200, {"name": row[0], "balance": row[1]})
            if len(parts) == 2 and parts[0] == "transfers":
                row = conn().execute(
                    "SELECT id, src, dst, amount, status FROM transfers WHERE id=%s", (parts[1],)).fetchone()
                if not row:
                    return self.reply(404, {"error": "no such transfer"})
                return self.reply(200, dict(zip(["id", "from", "to", "amount", "status"], row)))
            return self.reply(404, {"error": "not found"})
        except psycopg.Error as e:
            count("errors_total")
            return self.reply(503, {"error": f"database unavailable: {e.__class__.__name__}"})

    def do_POST(self):
        count("requests_total")
        parts = self.path.strip("/").split("/")
        try:
            body = self.read_json()
            if parts == ["accounts"]:
                name, balance = str(body["name"]), int(body.get("balance", 0))
                if balance < 0:
                    return self.reply(400, {"error": "balance must be >= 0"})
                conn().execute(
                    "INSERT INTO accounts(name, balance) VALUES (%s, %s) ON CONFLICT (name) DO NOTHING",
                    (name, balance))
                return self.reply(201, {"name": name})
            if parts == ["transfers"]:
                tid, src, dst, amount = str(body["id"]), str(body["from"]), str(body["to"]), int(body["amount"])
                if amount <= 0 or src == dst:
                    return self.reply(400, {"error": "amount must be > 0 and accounts must differ"})
                # Idempotent: the same id twice creates one transfer.
                conn().execute(
                    "INSERT INTO transfers(id, src, dst, amount) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                    (tid, src, dst, amount))
                count("transfers_requested_total")
                return self.reply(202, {"id": tid, "status": "pending"})
            return self.reply(404, {"error": "not found"})
        except (KeyError, ValueError, json.JSONDecodeError):
            return self.reply(400, {"error": "bad request body"})
        except psycopg.errors.ForeignKeyViolation:
            return self.reply(404, {"error": "no such account"})
        except psycopg.Error as e:
            count("errors_total")
            return self.reply(503, {"error": f"database unavailable: {e.__class__.__name__}"})


def main():
    db.init_schema(db.connect())
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)

    def stop(signum, frame):
        print("wallet-api: got SIGTERM, shutting down", file=sys.stderr, flush=True)
        threading.Thread(target=server.shutdown).start()

    signal.signal(signal.SIGTERM, stop)
    print(f"wallet-api pid={os.getpid()} port={PORT}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
