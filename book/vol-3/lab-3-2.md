# Lab 3.2 · A 3-Node etcd Cluster by Hand

## Goal

Run a real three-member etcd cluster, read and write it, kill its leader, take away its quorum, cut its leader off, and measure how long the cluster is unavailable after a leader crash. The measured numbers go into the chart below and into Milestone 3.

**Versions tested** (2026-11-16): `quay.io/coreos/etcd:v3.7.3` (members report 3.7.3, storage version 3.7.0), Docker Engine 29.9.2 in Docker Desktop on WSL2, Ubuntu 26.04 host, Python 3.14.4 for `elect.py`, the `cnlab-nettools` image from Lab 3.1. Not run: Ubuntu 24.04 with Docker Engine from apt.

**Machine note.** The election measurements ran on a busy shared laptop (load average 10 to 25 while other containers were running), so absolute values may be a little high. Expect the same pattern, not the same digits.

## What you will build

{{diagram lab-3-2-01.jsx | Lab 3.2 test bench · 3 etcd members}}

Each member is a container from the official etcd image, started with the same list of initial members and the same two timers. You control the cluster with `etcdctl` inside the containers and with `elect.py` from outside.

## Part A: start the cluster

Work in `~/cn-lab/vol3`. If you finished Lab 3.1 you already have the `cnlab-nettools` image and the `cnlab-vol3` network; the script creates the network if it is missing. Save this script:

```bash
#!/usr/bin/env bash
# etcd-up.sh [heartbeat_ms] [election_ms]  - start a 3-member etcd cluster
HB=${1:-100}; EL=${2:-1000}
IMG=quay.io/coreos/etcd:v3.7.3
docker network inspect cnlab-vol3 >/dev/null 2>&1 || docker network create cnlab-vol3 >/dev/null
CLUSTER=etcd1=http://etcd1:2380,etcd2=http://etcd2:2380,etcd3=http://etcd3:2380
i=0
for n in etcd1 etcd2 etcd3; do
  i=$((i+1))
  docker run -d --name $n --net cnlab-vol3 -p 127.0.0.1:$((22790+i)):2379 $IMG etcd \
    --name $n --data-dir /etcd-data \
    --listen-client-urls http://0.0.0.0:2379 --advertise-client-urls http://$n:2379 \
    --listen-peer-urls http://0.0.0.0:2380 --initial-advertise-peer-urls http://$n:2380 \
    --initial-cluster $CLUSTER --initial-cluster-token cnlab --initial-cluster-state new \
    --heartbeat-interval=$HB --election-timeout=$EL >/dev/null
done
```

Every member needs its own name, the address where it listens for clients (port 2379) and for the other members (port 2380), the list of initial members, and the two timers from Chapter 3.2 (heartbeat 100 ms and election timeout 1000 ms are etcd's defaults). Start it and define three shell helpers; `e` runs `etcdctl` against all members, `st` prints each member's leader flag, Raft term and Raft index, and `leader` prints the leader's name:

```bash
chmod +x etcd-up.sh && ./etcd-up.sh && sleep 4
e() { docker exec etcd1 etcdctl --endpoints=etcd1:2379,etcd2:2379,etcd3:2379 "$@"; }
st() { for n in etcd1 etcd2 etcd3; do docker exec $n etcdctl --endpoints=$n:2379 --command-timeout=2s endpoint status -w simple 2>/dev/null | awk -F', ' '{printf "%s leader=%s term=%s raftindex=%s\n",$1,$9,$11,$12}'; done; }
leader() { st | awk '/leader=true/{split($1,a,":"); print a[1]}'; }
st
e member list -w simple
e endpoint health -w table
```

```text
etcd1:2379 leader=true term=2 raftindex=8
etcd2:2379 leader=false term=2 raftindex=8
etcd3:2379 leader=false term=2 raftindex=8
b35da050139c4e6, started, etcd2, http://etcd2:2380, http://etcd2:2379, false
16255dc938030172, started, etcd3, http://etcd3:2380, http://etcd3:2379, false
d0d9645558c649e1, started, etcd1, http://etcd1:2380, http://etcd1:2379, false
┌────────────┬────────┬─────────────┬───────┐
│  ENDPOINT  │ HEALTH │    TOOK     │ ERROR │
├────────────┼────────┼─────────────┼───────┤
│ etcd1:2379 │   true │  14.17509ms │       │
│ etcd2:2379 │   true │ 17.962376ms │       │
│ etcd3:2379 │   true │ 34.828456ms │       │
└────────────┴────────┴─────────────┴───────┘
```

All three members agree on one leader, one term and one log position (Raft index 8). **Your leader may be a different member**, and the member IDs will differ. The term only ever goes up; watch how it changes in Part D.

## Part B: write, read and watch

Write a key twice, then read it with its metadata (`-w json`; the key and value are base64 text):

```bash
e put /wallet/greeting hello
e put /wallet/greeting hello2
e get /wallet/greeting -w json
e get /wallet/greeting --rev=2
```

```text
OK
OK
{"header":{"cluster_id":12969586430292558227,"member_id":15049169947559610849,"revision":3,"raft_term":2},"kvs":[{"key":"L3dhbGxldC9ncmVldGluZw==","create_revision":2,"mod_revision":3,"version":2,"value":"aGVsbG8y"}],"count":1}
/wallet/greeting
hello
```

Read the numbers. `revision: 3` is the cluster-wide counter: an empty etcd starts at revision 1, and your two writes made revisions 2 and 3. The key was created at revision 2 (`create_revision`), last changed at 3 (`mod_revision`), and has changed twice (`version: 2`). Because etcd keeps old revisions, `--rev=2` returned the *old* value, `hello`. This is exactly what Kubernetes' `resourceVersion` is.

Now watch. Open a **second terminal** and run (Ctrl+C stops it):

```bash
docker exec etcd1 etcdctl --endpoints=etcd1:2379 watch /wallet/greeting --rev=2
```

In the first terminal write once more with `e put /wallet/greeting live`. The watch first replays history from revision 2 and then prints the new change as it happens:

```text
PUT
/wallet/greeting
hello
PUT
/wallet/greeting
hello2
PUT
/wallet/greeting
live
```

This is how a controller learns that something changed without polling.

## Part C: compare-and-swap and leases

A *transaction* applies one of two sets of operations depending on a condition, atomically. `txn -i` reads three blocks separated by empty lines: the comparisons, the operations if they hold, the operations if they do not. Change the greeting only if it still equals `live`; then try again with the same, now outdated, expectation:

```bash
printf 'value("/wallet/greeting") = "live"\n\nput /wallet/greeting hello3\n\nget /wallet/greeting\n\n' | docker exec -i etcd1 etcdctl --endpoints=etcd1:2379 txn -i
printf 'value("/wallet/greeting") = "live"\n\nput /wallet/greeting hello4\n\nget /wallet/greeting\n\n' | docker exec -i etcd1 etcdctl --endpoints=etcd1:2379 txn -i
```

```text
compares:
success requests (get, put, del):
failure requests (get, put, del):
SUCCESS

OK
compares:
success requests (get, put, del):
failure requests (get, put, del):
FAILURE

/wallet/greeting
hello3
```

The first transaction found `live`, so it ran its `put` (SUCCESS). The second still expected `live`, found `hello3`, so it ran the failure branch, a `get` that shows who changed the value (FAILURE). Nothing was overwritten. This is *optimistic concurrency*: read, decide, write only if nobody interfered, otherwise retry.

A *lease* attaches a time limit to keys. Use it to build a lock: whoever creates `/wallet/leader` first holds it, and it disappears if the holder stops renewing.

```bash
ID=$(e lease grant 5 | awk '{print $2}')
printf 'create("/wallet/leader") = "0"\n\nput /wallet/leader ctl-A --lease=%s\n\nget /wallet/leader\n\n' $ID | docker exec -i etcd1 etcdctl --endpoints=etcd1:2379 txn -i
printf 'create("/wallet/leader") = "0"\n\nput /wallet/leader ctl-B\n\nget /wallet/leader\n\n' | docker exec -i etcd1 etcdctl --endpoints=etcd1:2379 txn -i
e get /wallet/leader --print-value-only; sleep 6; echo "after 6 s:"; e get /wallet/leader --print-value-only; echo "(end)"
```

```text
compares:
success requests (get, put, del):
failure requests (get, put, del):
SUCCESS

OK
compares:
success requests (get, put, del):
failure requests (get, put, del):
FAILURE

/wallet/leader
ctl-A
ctl-A
after 6 s:
(end)
```

`create("/wallet/leader") = "0"` means "the key has never been created". Controller A got the lock; B was refused and read `ctl-A` (the first `ctl-A` line is B's failure branch, the second is your own `get`). After the 5-second lease expired with nobody renewing it, the key vanished and B could take it. This is the mechanism behind leader election between copies of a Kubernetes controller. Chapter 3.1 warned that a lock based on timing alone can be wrong when its holder is paused; the Jepsen report found exactly that for etcd locks.

## Part D: crash the leader, then take away the quorum

First kill the leader and look at what the survivors do. `docker kill` prints the container's name.

```bash
st; L=$(leader); echo "leader is $L"
docker kill $L; sleep 3
st
```

```text
etcd1:2379 leader=true term=2 raftindex=20
etcd2:2379 leader=false term=2 raftindex=20
etcd3:2379 leader=false term=2 raftindex=20
leader is etcd1
etcd1
etcd2:2379 leader=true term=3 raftindex=21
etcd3:2379 leader=false term=3 raftindex=21
```

(Your Raft indexes depend on what you wrote; the pattern is what matters.) The dead member prints no line. The survivors elected a new leader and the term rose from 2 to 3. The Raft index rose by one, which fits the new leader appending an entry of its own term. Writes work through any survivor, and when the old leader comes back it rejoins as a follower and catches up:

```bash
S=$(for n in etcd1 etcd2 etcd3; do [ $n != $L ] && echo $n; done | head -1)
docker exec $S etcdctl --endpoints=$S:2379 put /wallet/after-kill still-works
docker start $L; sleep 4; st
```

```text
OK
etcd1
etcd1:2379 leader=false term=3 raftindex=23
etcd2:2379 leader=true term=3 raftindex=23
etcd3:2379 leader=false term=3 raftindex=23
```

All three members show the same index again: the returning member received the entries it missed. Now go further and kill **both followers**, leaving the leader alone with no majority. Define `x` to talk to the survivor with a 3-second limit, and try four requests:

```bash
L=$(leader)
for n in etcd1 etcd2 etcd3; do [ $n != $L ] && docker kill $n; done
x() { docker exec $L etcdctl --endpoints=$L:2379 --command-timeout=3s "$@" 2>&1 | grep -v '^{"level"'; }
x put /wallet/x 1
x get /wallet/greeting
x get /wallet/greeting --consistency=s --print-value-only
x endpoint health
```

```text
etcd1
etcd3
Error: context deadline exceeded
Error: context deadline exceeded
hello3
etcd2:2379 is unhealthy: failed to commit proposal: context deadline exceeded
Error: unhealthy cluster
```

The write fails: a single member cannot commit, however alive it is. The default read also fails, because a linearizable read must be confirmed by a majority. The *serializable* read (`--consistency=s`) answers at once from the member's own copy: `hello3`, correct here, but only because nothing changed; it could be stale. **This one flag is the CAP choice.** Without it etcd is consistent and unavailable in the minority; with it, available and possibly stale. Restart the followers and the cluster recovers by itself:

```bash
docker start $(for n in etcd1 etcd2 etcd3; do [ $n != $L ] && echo $n; done); sleep 5; st; x put /wallet/x 1
```

```text
etcd1:2379 leader=true term=4 raftindex=26
etcd2:2379 leader=false term=4 raftindex=26
etcd3:2379 leader=false term=4 raftindex=26
OK
```

## Part E: take a backup

A snapshot is one consistent file of the whole database. Take one inside a member and inspect it:

```bash
docker exec etcd1 etcdctl --endpoints=etcd1:2379 snapshot save /tmp/backup.db
docker exec etcd1 etcdutl --write-out=table snapshot status /tmp/backup.db
```

```text
Snapshot saved at /tmp/backup.db
Server version 3.7.0
┌──────────┬──────────┬────────────┬────────────┬─────────┐
│   HASH   │ REVISION │ TOTAL KEYS │ TOTAL SIZE │ VERSION │
├──────────┼──────────┼────────────┼────────────┼─────────┤
│ 8fccce91 │        9 │          3 │      20 kB │   3.7.0 │
└──────────┴──────────┴────────────┴────────────┴────────┘
```

The file lives inside the container; copy it out with `docker cp etcd1:/tmp/backup.db .` (not run here) if you want to keep it. In a real cluster this command runs on a schedule and the file goes to storage outside the cluster.

## Part F: measure the election time

Chapter 3.2 predicted that a leader crash makes writes fail for about 1.33 election timeouts. Test it. `elect.py` runs against the cluster you started with `etcd-up.sh` (client ports 22791 to 22793). A writer sends one `put` every 10 ms to the two surviving members; the script reports the outage as the time from the first failed `put` to the first later successful one. It then restarts the killed member and repeats.

```python
#!/usr/bin/env python3
# elect.py <trials> <label> - kill the etcd leader N times and measure how long clients cannot write.
import base64, json, subprocess, sys, threading, time, urllib.request

PORTS = {"etcd1": 22791, "etcd2": 22792, "etcd3": 22793}

def call(name, path, body, timeout):
    req = urllib.request.Request(f"http://127.0.0.1:{PORTS[name]}{path}", json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def status(name):
    try:
        s = call(name, "/v3/maintenance/status", {}, 0.5)
        return int(s["header"]["member_id"]), int(s.get("leader", 0)), int(s["raftTerm"])
    except Exception:
        return None

def find_leader():
    while True:
        up = {n: status(n) for n in PORTS}
        if all(up.values()) and len({s[1] for s in up.values()}) == 1 and up["etcd1"][1] != 0:
            lid = up["etcd1"][1]
            return next(n for n, s in up.items() if s[0] == lid), up["etcd1"][2]
        time.sleep(0.1)

def put(name, log):
    t = time.monotonic(); ok = True
    try:
        call(name, "/v3/kv/put", {"key": base64.b64encode(b"/probe").decode(), "value": "dg=="}, 1.0)
    except Exception:
        ok = False
    log.append((t, ok, time.monotonic()))

trials, label = int(sys.argv[1]), sys.argv[2]
print("label,trial,killed,outage_ms,term_before,term_after")
for n in range(1, trials + 1):
    leader, term0 = find_leader(); time.sleep(1.0)
    survivors = [x for x in PORTS if x != leader]; log = []
    stop = threading.Event()
    def writer():
        i = 0
        while not stop.is_set():
            threading.Thread(target=put, args=(survivors[i % 2], log), daemon=True).start()
            i += 1; time.sleep(0.01)
    threading.Thread(target=writer, daemon=True).start()
    time.sleep(0.5)
    subprocess.run(["docker", "kill", leader], capture_output=True)
    while True:
        time.sleep(0.2)
        fails = [r for r in list(log) if not r[1]]
        if fails:
            t_fail = min(r[0] for r in fails)
            later = [r[2] for r in list(log) if r[1] and r[0] > t_fail]
            if later: break
    stop.set(); time.sleep(0.3)
    outage = (min(later) - t_fail) * 1000
    _, _, term1 = status(survivors[0])
    print(f"{label},{n},{leader},{outage:.0f},{term0},{term1}", flush=True)
    subprocess.run(["docker", "start", leader], capture_output=True)
    time.sleep(2)
```

Run it on the default timers first, on a fresh cluster:

```bash
docker rm -f etcd1 etcd2 etcd3; ./etcd-up.sh; sleep 4
python3 elect.py 5 default
```

Each row is one kill: which member was the leader, the outage in milliseconds, and the term before and after. With the default 1000 ms election timeout expect outages between about 1000 and 2000 ms, because each follower's timer is drawn from 1000 to 2000 ms and the first to fire wins. Now vary the timeout. This script restarts the cluster with four settings (heartbeat always one tenth of the election timeout) and kills the leader 10 times for each. It takes 5 to 10 minutes:

```bash
cat > run-elect.sh <<'EOF'
#!/usr/bin/env bash
echo "label,trial,killed,outage_ms,term_before,term_after" > elect.csv
for el in 250 500 1000 2000; do
  docker rm -f etcd1 etcd2 etcd3 >/dev/null 2>&1
  ./etcd-up.sh $((el/10)) $el; sleep 4
  python3 elect.py 10 "$el" | tail -n +2 >> elect.csv
done
docker rm -f etcd1 etcd2 etcd3 >/dev/null 2>&1
EOF
chmod +x run-elect.sh && ./run-elect.sh
head -4 elect.csv
```

```text
label,trial,killed,outage_ms,term_before,term_after
250,1,etcd1,315,2,3
250,2,etcd2,394,3,4
250,3,etcd3,258,4,5
```

Summarise it (setting, kills, minimum, median, maximum in milliseconds):

```bash
python3 - <<'EOF'
import csv, statistics as st, collections
d = collections.defaultdict(list)
for r in csv.DictReader(open('elect.csv')): d[int(r['label'])].append(int(r['outage_ms']))
for k, v in sorted(d.items()): print(k, len(v), min(v), round(st.median(v)), max(v))
EOF
```

```text
250 10 257 330 434
500 10 509 589 901
1000 10 1017 1280 1552
2000 10 1905 2480 3310
```

{{diagram lab-3-2-02.jsx | measured with elect.py · 40 leader kills, 4 election timeouts, 3 members}}

The chart divides each outage by that run's election timeout T, so the four settings share one axis. Three facts stand out. First, no outage was shorter than 0.95 T: a cluster cannot recover faster than a follower's timer allows (the timers began counting at the last heartbeat, slightly before the crash). Second, all 40 outages fall between 0.95 T and 1.8 T, inside or just under the band from T to 2T, the range each follower's timer is drawn from. Third, the medians sit near 1.3 T, matching the 1.33 T expected when the first of two random timers fires. The election timeout is the price of a leader crash, and halving it halves the outage.

Do not stop there. A shorter timeout is not free: the etcd guide asks for at least ten times the round-trip time between members, and a timeout shorter than a disk stall or a busy network turns every pause into an election. The 250 ms setting is safe here only because all three members share one machine, so their round trip is tiny. Across availability zones a round trip is milliseconds, and the ten-times rule sets the floor.

## Checkpoint

Compare your results with these. Member names, terms and indexes will differ; the pattern must match.

| Check | Expected |
| --- | --- |
| `st` right after Part A | Three lines, exactly one with `leader=true`, and the same `term` and `raftindex` on all three |
| `e get /wallet/greeting -w json` after the two `put`s | `create_revision` 2, `mod_revision` 3, `version` 2 |
| The second `txn` in Part C | Prints `FAILURE` and the current value `hello3` |
| `st` three seconds after `docker kill $L` | A different member has `leader=true`, the term is one higher, and the killed member prints no line |
| `st` four seconds after `docker start $L` | All three members show the same `raftindex` |
| With two members killed: `x put` and `x get` | `Error: context deadline exceeded` for both |
| With two members killed: `x get ... --consistency=s` | Prints the value at once |
| `etcdutl ... snapshot status` | A table with `REVISION` and `TOTAL KEYS` |
| `elect.csv`, setting `1000` | Every `outage_ms` between about 950 and 2000, median near 1300 |

## Break it

A crash is easy: the leader is simply gone. A partition is harder, because the old leader is alive and cannot know it has been replaced. **Predict first:** if you cut the leader off from both followers, does it keep acting as leader, and what happens to a write sent to it? Then try. Start a fresh cluster and cut the leader's network to its two peers with a sidecar:

```bash
docker rm -f etcd1 etcd2 etcd3 >/dev/null; ./etcd-up.sh; sleep 4
L=$(leader); echo "leader=$L"
docker run -d --name lead-net --net container:$L --cap-add NET_ADMIN cnlab-nettools sleep infinity
PEERS=$(for n in etcd1 etcd2 etcd3; do [ $n != $L ] && docker exec lead-net getent hosts $n | awk '{print $1}'; done | tr '\n' ' ')
docker exec lead-net sh -c "nft add table inet cnlab; nft add chain inet cnlab out '{ type filter hook output priority 0; }'; nft add chain inet cnlab in '{ type filter hook input priority 0; }'; for p in $PEERS; do nft add rule inet cnlab out ip daddr \$p drop; nft add rule inet cnlab in ip saddr \$p drop; done"
sleep 5; st
docker exec $L etcdctl --endpoints=$L:2379 --command-timeout=3s put /wallet/split old 2>&1 | grep -v '^{"level"'
M=$(for n in etcd1 etcd2 etcd3; do [ $n != $L ] && echo $n; done | head -1)
docker exec $M etcdctl --endpoints=$M:2379 --command-timeout=3s put /wallet/split new
docker exec lead-net nft delete table inet cnlab; sleep 8; st
docker exec $L etcdctl --endpoints=$L:2379 get /wallet/split --print-value-only
```

```text
leader=etcd1
etcd1:2379 leader=false term=4 raftindex=27
etcd2:2379 leader=true term=5 raftindex=28
etcd3:2379 leader=false term=5 raftindex=28
Error: context deadline exceeded
OK
etcd1:2379 leader=false term=5 raftindex=29
etcd2:2379 leader=true term=5 raftindex=29
etcd3:2379 leader=false term=5 raftindex=29
new
```

(The first `st` is five seconds into the partition; the last is eight seconds after healing. This sample came from a cluster that had already held several elections, so on a fresh cluster your terms and indexes are lower, for example 2 and 3 instead of 4 and 5; the pattern is the same.) Read it. The majority side elected a new leader in term 5 and committed the write `new`. The old leader, alone in term 4, **stepped down by itself**: it shows `leader=false` although nobody told it anything, and the write sent to it timed out instead of succeeding. After the heal it adopted term 5, caught up (index 29), and its own `get` returns `new`. Nothing was lost and no two leaders ever committed different entries.

Why did it step down? A leader that cannot reach a majority must not keep acting as leader. The Raft library etcd uses documents this option: "CheckQuorum specifies if the leader should check quorum activity. Leader steps down when quorum is not active for an electionTimeout" ([etcd-io/raft](https://github.com/etcd-io/raft/blob/main/raft.go)), and etcd 3.7.3 turns it on ([bootstrap.go](https://github.com/etcd-io/etcd/blob/v3.7.3/server/etcdserver/bootstrap.go)). It also enables Pre-Vote by default, so a member that was cut off does not disrupt the cluster when it returns ([config.go](https://github.com/etcd-io/etcd/blob/v3.7.3/server/embed/config.go)). Neither feature is in the base algorithm of the paper; real implementations add such guards.

**Diagnose and write down:** which of the five failure models in Chapter 3.1's table did this experiment inject, and which property of Raft (from the paper's Figure 3) guarantees that `old` was never committed?

## Clean up

```bash
docker rm -f etcd1 etcd2 etcd3 lead-net
docker network rm cnlab-vol3   # only if no other container uses it
```

Keep `elect.csv`: Milestone 3 asks for its numbers.
