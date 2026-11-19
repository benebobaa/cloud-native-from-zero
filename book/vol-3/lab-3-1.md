# Lab 3.1 · Partitioning the Wallet's Replicas

## Goal

Cut a network on purpose, three ways, and record what a real wallet and a toy replicated register do. You leave with the measured facts that Milestone 3's written partition analysis needs.

**Versions tested** (2026-11-16): Docker Engine 29.9.2 in Docker Desktop on WSL2 (kernel 6.18.58.1-microsoft-standard-WSL2 inside the Docker VM), Ubuntu 26.04 host, `postgres:17`, `wallet:v1`, `python:3.12-slim`, `alpine:3.21` with iproute2 6.11.0 and nftables 1.1.1. Not run: Ubuntu 24.04 with Docker Engine from apt (same commands expected to work, not verified).

## What you will build

{{diagram lab-3-1-01.jsx | Lab 3.1 test bench · 2 systems, 2 sidecars}}

Each sidecar shares the network of the container it is attached to, so a firewall rule or a `tc` delay added in the sidecar acts on exactly that container. The cross between the two boxes of a group is a *partition*: both sides are healthy and cannot hear each other.

## Part A: build the test bench

You need a small image with the network tools, one Postgres and one wallet API. Run everything from a new folder.

```bash
mkdir -p ~/cn-lab/vol3 && cd ~/cn-lab/vol3
cat > Dockerfile.nettools <<'EOF'
FROM alpine:3.21
RUN apk add --no-cache iproute2 nftables curl
EOF
docker build -q -t cnlab-nettools -f Dockerfile.nettools .
docker network create cnlab-vol3
docker run -d --name pg --net cnlab-vol3 -e POSTGRES_USER=wallet -e POSTGRES_PASSWORD=wallet -e POSTGRES_DB=wallet postgres:17
docker build -q -t wallet:v1 <path to the course's wallet/ folder>   # skip if wallet:v1 already exists
sleep 5
docker run -d --name api --net cnlab-vol3 -p 127.0.0.1:28180:8080 -e DATABASE_URL=postgresql://wallet:wallet@pg:5432/wallet wallet:v1
docker run -d --name api-net --net container:api --cap-add NET_ADMIN cnlab-nettools sleep infinity
```

Port 28180 is arbitrary; pick another free one if it is taken. Check that the wallet works and create an account:

```bash
curl -s localhost:28180/readyz
curl -s -XPOST localhost:28180/accounts -d '{"name":"alice","balance":100}'
```

```text
{"status": "ready"}
{"name": "alice"}
```

From now on you time requests from *inside* the sidecar. It shares the API's network, so `localhost:8080` reaches the API over the loopback interface, which your experiments will not touch; only the API's traffic to Postgres crosses `eth0`. Define two helpers and take a baseline:

```bash
T() { docker exec api-net curl -s --max-time "${2:-8}" -o /dev/null -w "$1 %{http_code} %{time_total}s\n" localhost:8080/accounts/alice; }
R() { docker exec api-net curl -s --max-time "${3:-8}" -o /dev/null -w "$1 %{http_code} %{time_total}s\n" localhost:8080/$2; }
T base; T base
```

```text
base 200 0.009139s
base 200 0.008379s
```

## Part B: a slow and lossy link (`tc netem`)

Fallacy 2 says latency is zero. Add delay to everything the API sends out through `eth0`, which here means its conversation with Postgres:

```bash
for d in 50 100 200 400; do
  docker exec api-net tc qdisc replace dev eth0 root netem delay ${d}ms
  T "delay ${d}ms"
done
```

```text
delay 50ms 200 0.312590s
delay 100ms 200 0.612327s
delay 200ms 200 1.214708s
delay 400ms 200 2.411293s
```

Every added 50 ms costs the wallet about 300 ms: six times as much. The reason is in `api.py`: each server thread keeps its own database connection, and the HTTP server starts a new thread for every connection, so each request opens a new Postgres connection (`db.connect()`), authenticates, and only then runs its query. Six sequential sends fits what we measured; we did not capture packets to count them. The lesson is general: **delay is multiplied by how chatty the protocol is**.

Now replace delay with random loss:

```bash
docker exec api-net tc qdisc replace dev eth0 root netem loss 30%
for i in 1 2 3 4 5 6; do T "loss 30%"; done
```

```text
loss 30% 200 1.890303s
loss 30% 200 4.096472s
loss 30% 200 0.423214s
loss 30% 200 1.689562s
loss 30% 200 0.011833s
loss 30% 200 0.426652s
```

Seventy per cent of packets still arrive, yet one request took 4 s and another 0.01 s. TCP retransmits a lost packet only after a timeout that doubles with each repeated loss, so loss shows up as spiky latency, not as a small slowdown. Finally lose everything, then remove the rule:

```bash
docker exec api-net tc qdisc replace dev eth0 root netem loss 100%
T "loss 100%" 6
docker exec api-net tc qdisc del dev eth0 root
T healed
```

```text
loss 100% 000 6.002589s
healed 200 0.008710s
```

Status `000` means curl got no answer at all in 6 s. Dead, slow or lost? From this side you cannot tell; that is the ambiguity of the chapter's first diagram.

## Part C: cut the wallet off from its database (`nft`)

A real partition leaves both sides healthy. Look up Postgres's address and drop all packets between the API and it, in both directions:

```bash
PG=$(docker exec api-net getent hosts pg | awk '{print $1}'); echo $PG
docker exec api-net sh -c "nft add table inet cnlab; \
  nft add chain inet cnlab out '{ type filter hook output priority 0; }'; \
  nft add chain inet cnlab in '{ type filter hook input priority 0; }'; \
  nft add rule inet cnlab out ip daddr $PG drop; \
  nft add rule inet cnlab in ip saddr $PG drop"
R healthz healthz; R readyz readyz 6; R account accounts/alice 6
```

```text
172.22.0.2
healthz 200 0.001256s
readyz 000 6.001866s
account 000 6.001436s
```

`/healthz` answers at once because it never touches the database. `/readyz` and the account lookup wait until curl gives up. The API process and Postgres are both running and both fine; the wallet is unusable. That is a partition. Heal it by deleting your own table (never `nft flush ruleset`, see the command table):

```bash
docker exec api-net nft delete table inet cnlab
T healed
```

```text
healed 200 0.019864s
```

Now refuse the connection loudly instead of dropping it silently (`reject with tcp reset`) and time `/readyz`:

```bash
docker exec api-net sh -c "nft add table inet cnlab; \
  nft add chain inet cnlab out '{ type filter hook output priority 0; }'; \
  nft add rule inet cnlab out ip daddr $PG reject with tcp reset"
R readyz readyz 40
docker exec api-net nft delete table inet cnlab
```

```text
readyz 503 29.044503s
```

A refusal is instant, yet the wallet needed 29 seconds to say `503`. `db.connect()` in `db.py` retries 30 times, one second apart, before it gives up, so the wallet's own retry policy hides the failure for half a minute. A probe with a short timeout (Vol 5) would have given up long before that.

**Reading it with CAP.** In both experiments the wallet never invented a balance. When it could not reach its single database it refused or hung, so it chose consistency over availability: a PC system. A wallet that answered from a stale cache would be the other choice. Write down which you prefer for a bank and why; Milestone 3 asks.

## Part D: two replicas, two policies

The wallet has one database, so it has nothing to disagree with. Real replicated systems have copies, and during a partition the copies must choose. `kv.py` is a register (one value) kept on two nodes. In `cp` mode a write is accepted only if the other node confirms it; in `ap` mode a write is accepted at once and copied later, with a once-a-second repair that keeps the newest timestamp (*last writer wins*). Save the three files next to each other in `~/cn-lab/vol3`.

```python
#!/usr/bin/env python3
# kv.py - a two-node replicated register. MODE=cp refuses writes it cannot replicate; MODE=ap accepts them anyway.
import json, os, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

NAME, PEER, MODE = os.environ["NAME"], os.environ["PEER"], os.environ.get("MODE", "ap")
SKEW = float(os.environ.get("SKEW", "0"))          # seconds this node's clock is wrong
state = {"value": "init", "ts": 0.0}
lock = threading.Lock()
now = lambda: time.time() + SKEW

def post(path, body, timeout):
    req = urllib.request.Request(f"http://{PEER}:8000{path}", json.dumps(body).encode())
    return urllib.request.urlopen(req, timeout=timeout)

def tell_peer(v, ts):
    try: post("/replicate", {"value": v, "ts": ts}, 0.5).close()
    except Exception: pass                          # partitioned: anti-entropy will catch up later

def merge(value, ts):                               # last-writer-wins by timestamp
    with lock:
        if ts > state["ts"]:
            state.update(value=value, ts=ts)

def anti_entropy():                                 # every second, pull the peer's value
    while True:
        time.sleep(1)
        try:
            r = json.load(urllib.request.urlopen(f"http://{PEER}:8000/get", timeout=0.5))
            merge(r["value"], r["ts"])
        except Exception:
            pass

class H(BaseHTTPRequestHandler):
    def reply(self, code, body):
        data = json.dumps(body).encode() + b"\n"
        self.send_response(code); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
    def log_message(self, *a): pass
    def do_GET(self):
        with lock: self.reply(200, {"node": NAME, **state})
    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/replicate":
            b = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            merge(b["value"], b["ts"]); return self.reply(200, {"ok": True})
        v, ts = parse_qs(u.query)["v"][0], now()
        if MODE == "cp":
            try: post("/replicate", {"value": v, "ts": ts}, 1.0)
            except Exception: return self.reply(503, {"node": NAME, "error": "cannot reach peer, write refused"})
            merge(v, ts); return self.reply(200, {"node": NAME, "stored": v})
        merge(v, ts)                                # ap: store locally first, tell the peer if we can
        threading.Thread(target=tell_peer, args=(v, ts), daemon=True).start()
        self.reply(200, {"node": NAME, "stored": v})

threading.Thread(target=anti_entropy, daemon=True).start()
ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
```

`cap-up.sh` starts the two nodes and a sidecar for each. `cap-run.py` then writes to node A five times a second for 20 seconds, cuts A off from B from second 5 to second 15, and at the same time reads node B five times a second, counting reads that differ from the last value A acknowledged.

```bash
#!/usr/bin/env bash
# cap-up.sh <ap|cp> [skew_seconds_for_b]
MODE=${1:-ap}; SKEW_B=${2:-0}
docker rm -f kv-a kv-b kv-a-net kv-b-net >/dev/null 2>&1
for n in a b; do
  skew=0; [ $n = b ] && skew=$SKEW_B; p=28101; [ $n = b ] && p=28102; peer=b; [ $n = b ] && peer=a
  docker run -d --name kv-$n --net cnlab-vol3 -p 127.0.0.1:$p:8000 -v "$PWD/kv.py:/kv.py:ro" \
    -e NAME=$n -e PEER=kv-$peer -e MODE=$MODE -e SKEW=$skew python:3.12-slim python /kv.py >/dev/null
  docker run -d --name kv-$n-net --net container:kv-$n --cap-add NET_ADMIN cnlab-nettools sleep infinity >/dev/null
done
sleep 2
```

```python
#!/usr/bin/env python3
# cap-run.py <ap|cp> -> CSV on stdout: second, writes accepted, writes failed, stale reads
import collections, json, subprocess, sys, threading, time, urllib.request

mode = sys.argv[1]
A, B = "http://127.0.0.1:28101", "http://127.0.0.1:28102"
t0 = time.monotonic()
ok, bad, stale = (collections.Counter() for _ in range(3))
acked = {"v": "init"}                       # last value A confirmed to the client

def http(method, url, timeout):
    req = urllib.request.Request(url, method=method, data=b"" if method == "POST" else None)
    return json.load(urllib.request.urlopen(req, timeout=timeout))

def writer():
    i = 0
    while time.monotonic() - t0 < 20:
        tick, sec = time.monotonic(), int(time.monotonic() - t0)
        i += 1
        try:
            http("POST", f"{A}/put?v=w{i}", 3); acked["v"] = f"w{i}"; ok[sec] += 1
        except Exception:
            bad[sec] += 1
        time.sleep(max(0, 0.2 - (time.monotonic() - tick)))

def reader():                               # a client that reads from B: does it see what A acknowledged?
    time.sleep(0.1)                         # sample between the writer's ticks
    while time.monotonic() - t0 < 20:
        tick, sec = time.monotonic(), int(time.monotonic() - t0)
        want = acked["v"]
        try:
            if http("GET", f"{B}/get", 1)["value"] != want: stale[sec] += 1
        except Exception:
            pass
        time.sleep(max(0, 0.2 - (time.monotonic() - tick)))

def nft(cmd): subprocess.run(["docker", "exec", "kv-a-net", "sh", "-c", cmd], capture_output=True)

peer = subprocess.run(["docker", "exec", "kv-a-net", "getent", "hosts", "kv-b"], capture_output=True, text=True).stdout.split()[0]
threads = [threading.Thread(target=f) for f in (writer, reader)]
[t.start() for t in threads]
time.sleep(5 - (time.monotonic() - t0))
nft(f"nft add table inet cnlab; nft add chain inet cnlab out '{{ type filter hook output priority 0; }}'; "
    f"nft add chain inet cnlab in '{{ type filter hook input priority 0; }}'; "
    f"nft add rule inet cnlab out ip daddr {peer} drop; nft add rule inet cnlab in ip saddr {peer} drop")
time.sleep(15 - (time.monotonic() - t0))
nft("nft delete table inet cnlab")
[t.join() for t in threads]
print("mode,t,writes_ok,writes_failed,reads_stale")
for s in range(20):
    print(f"{mode},{s},{ok[s]},{bad[s]},{stale[s]}")
```

Run both modes and keep the CSV files:

```bash
chmod +x cap-up.sh
./cap-up.sh cp && python3 cap-run.py cp > cap-cp.csv
./cap-up.sh ap && python3 cap-run.py ap > cap-ap.csv
for f in cap-cp.csv cap-ap.csv; do sed -n '5,17p' $f; done
```

{{diagram lab-3-1-02.jsx | measured with cap-run.py · 2 runs of 20 s, second 0 dropped as warm-up}}

The chart is built from the CSV files of one run on the test machine; your numbers will differ by a write or two. Read it in three parts. **Before the partition** both registers behave the same: all five writes a second are accepted and reads from B match. **During it** the CP node stops accepting writes within the first second, because every write needs B's confirmation and B cannot answer; the client gets `503` and nothing is stored, so B is never behind. The AP node keeps accepting all five writes a second, but every read from B returns an old value, since B has not heard about any of them. **After the heal** CP resumes at once, and AP's reads become correct about a second later, when the once-a-second repair copies A's value to B.

This is CAP's choice made visible. CP gave up availability to keep every reader consistent. AP gave up consistency to keep every writer happy. Neither is wrong; the next experiment shows what AP costs.

## Part E: the wrong clock

AP mode resolves two conflicting writes by keeping the one with the newer timestamp. That is safe only if timestamps tell the truth. Restart the AP pair with node B's clock 30 seconds slow, cut the link, write `red` to A, wait two seconds, write `blue` to B, then heal:

```bash
./cap-up.sh ap -30
PEER=$(docker exec kv-a-net getent hosts kv-b | awk '{print $1}')
docker exec kv-a-net sh -c "nft add table inet cnlab; \
  nft add chain inet cnlab out '{ type filter hook output priority 0; }'; \
  nft add chain inet cnlab in '{ type filter hook input priority 0; }'; \
  nft add rule inet cnlab out ip daddr $PEER drop; \
  nft add rule inet cnlab in ip saddr $PEER drop"
curl -s -XPOST "localhost:28101/put?v=red"; sleep 2; curl -s -XPOST "localhost:28102/put?v=blue"
docker exec kv-a-net nft delete table inet cnlab; sleep 3
curl -s localhost:28101/get; curl -s localhost:28102/get
```

```text
{"node": "a", "stored": "red"}
{"node": "b", "stored": "blue"}
{"node": "a", "value": "red", "ts": 1794814423.5577154}
{"node": "b", "value": "red", "ts": 1794814423.5577154}
```

Both nodes now hold `red`. The `blue` write happened later in real time, but B stamped it with its slow clock (28 seconds smaller than A's `red`), so last-writer-wins discarded it, and B's client was told `stored`. Run `./cap-up.sh ap 0` and repeat: both nodes end with `blue`, as a human would expect. Nothing in the system noticed the difference. That is the cost of AP with wall-clock timestamps, and the reason Dynamo keeps vector clocks instead ([Dynamo paper](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf)): ordering must come from causality, not from clocks.

## Checkpoint

Compare your results with these. Timings vary a little; the pattern must match.

| Check | Expected |
| --- | --- |
| `docker exec api-net curl -s localhost:8080/readyz` after Part A | `{"status": "ready"}` |
| `T` with `netem delay 50ms` | about 0.3 s, six times the added delay (0.25 s to 0.4 s) |
| `T` with `netem loss 100%` and a 6 s limit | status `000` after 6 s |
| `R healthz healthz` while the `nft drop` rules are in place | `200` in milliseconds |
| `R readyz readyz 6` while they are in place | `000` after 6 s |
| `R readyz readyz 40` with the `reject with tcp reset` rule | `503` after about 29 s |
| `cap-cp.csv`, rows for seconds 6 to 14 | `writes_ok` is 0 in every row |
| `cap-ap.csv`, rows for seconds 6 to 14 | `writes_ok` is 5 and `reads_stale` is 4 or 5 in every row |
| Part E with skew `-30` | both nodes return `red` |
| Part E with skew `0` | both nodes return `blue` |

## Break it

A partition that drops packets silently is worse than one that refuses them. **Predict first:** how long will a wallet client wait if nothing in the chain has a timeout? Then start a second API whose database URL adds `connect_timeout=2` (a standard Postgres connection setting), cut both APIs off from Postgres, and time `/readyz` on each:

```bash
docker run -d --name api2 --net cnlab-vol3 -p 127.0.0.1:28181:8080 \
  -e "DATABASE_URL=postgresql://wallet:wallet@pg:5432/wallet?connect_timeout=2" wallet:v1
docker run -d --name api2-net --net container:api2 --cap-add NET_ADMIN cnlab-nettools sleep infinity
for n in api-net api2-net; do
  docker exec $n sh -c "nft add table inet cnlab; \
    nft add chain inet cnlab out '{ type filter hook output priority 0; }'; \
    nft add rule inet cnlab out ip daddr $PG drop"
done
curl -s -o /dev/null -w 'api  %{http_code} %{time_total}s\n' --max-time 200 localhost:28180/readyz &
curl -s -o /dev/null -w 'api2 %{http_code} %{time_total}s\n' --max-time 200 localhost:28181/readyz &
wait
```

```text
api2 503 90.642s
api  000 200.0s
```

(The second line is the original API: curl gave up at its own 200 s limit, so the digits vary.) The API without a timeout gave no answer in 200 s. The kernel keeps retrying a dropped connection for a long time, and `db.connect()` then repeats the attempt 30 times. With `connect_timeout=2` each attempt fails after 2 s, and 30 attempts one second apart give the 90 s you measured: 30 × (2 s + 1 s). **Diagnose:** a timeout must exist at every hop, and a retry loop multiplies whatever timeout sits inside it. Write one sentence naming the retry count in `db.py` and the setting you would add to `DATABASE_URL` so that `/readyz` answers in under 5 seconds, together with the smaller retry count you would pair with it. Remove the rules before moving on (`nft delete table inet cnlab` in both sidecars).

## Clean up

```bash
docker rm -f api api2 api-net api2-net pg kv-a kv-b kv-a-net kv-b-net
docker network rm cnlab-vol3
```

Keep `cap-cp.csv`, `cap-ap.csv` and your notes from Parts B, C and E: Milestone 3 uses them.
