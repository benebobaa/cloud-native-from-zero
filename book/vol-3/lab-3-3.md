# Lab 3.3 · A Reconcile Loop against etcd

## Goal

Build the controller of Chapter 3.3 and watch it work and fail. First you see why a script that starts workers goes wrong. Then you write about 70 lines that hold the fleet at the number stored in etcd, measure how fast it repairs a death, take away etcd's majority, and finally run two copies and watch them fight. The numbers go into the charts below and into Milestone 3.

**Versions tested** (2026-11-17): `quay.io/coreos/etcd:v3.7.3` (the cluster from Lab 3.2), `postgres:17`, `wallet:v1` (built from `wallet/`, Python 3.12 inside), Docker Engine 29.9.2 in Docker Desktop on WSL2, Ubuntu 26.04 host, Python 3.14.4 for `controller.py`, `measure.py` and `count.py` (standard library only). Not run: Ubuntu 24.04 with Docker Engine from apt.

**Machine note.** The timings ran on a busy shared laptop (load average 18 to 24 while other containers were running), where `docker run` often took 1 to 3 s. Absolute repair times are therefore larger than on a quiet machine. Expect the same ordering of the three settings, not the same digits.

## What you will build

{{diagram lab-3-3-01.jsx | Lab 3.3 test bench · 1 controller, 3 etcd members, 3 workers}}

The controller is an ordinary program on your laptop. Every pass it asks etcd for the goal, asks Docker which labelled containers exist, and starts or removes containers to match. The workers are the real `wallet-worker` from `wallet:v1`; they share one Postgres and know nothing about the controller.

## Part A: the fleet by hand, and why scripts fail

Work in `~/cn-lab/vol3`. You need Postgres and the etcd cluster from Labs 3.1 and 3.2. If those containers are gone, recreate them (`etcd-up.sh` is the script from Lab 3.2), then define two helpers: `e` talks to etcd and `W` lists your workers.

```bash
cd ~/cn-lab/vol3
docker rm -f etcd1 etcd2 etcd3 pg >/dev/null 2>&1; ./etcd-up.sh
docker run -d --name pg --net cnlab-vol3 -e POSTGRES_USER=wallet -e POSTGRES_PASSWORD=wallet -e POSTGRES_DB=wallet postgres:17
e() { docker exec etcd1 etcdctl --endpoints=etcd1:2379,etcd2:2379,etcd3:2379 "$@"; }
W() { docker ps -a --filter label=cnlab.role=wallet-worker --format '{{.Names}} {{.State}}'; }
sleep 5; e endpoint health -w table
```

Start three workers the imperative way. Each one is the wallet's worker program with a label that marks it as yours. Save this script:

```bash
cat > start-workers.sh <<'EOF'
#!/usr/bin/env bash
# start-workers.sh <count> - the imperative way: start <count> new wallet workers
for i in $(seq "$1"); do
  docker run -d --label cnlab.role=wallet-worker --name ww-$RANDOM --net cnlab-vol3 \
    -e DATABASE_URL=postgresql://wallet:wallet@pg:5432/wallet wallet:v1 python3 worker.py >/dev/null
done
EOF
chmod +x start-workers.sh
./start-workers.sh 3; sleep 2; W
./start-workers.sh 3; sleep 2; W | wc -l
```

```text
ww-357 running
ww-32346 running
ww-17634 running
6
```

You asked for three workers and now have six: the script never looked at what already existed (the left panel of the chapter's imperative-versus-declarative drawing). Your names will differ. Now try the smarter script, which reacts to each death. It is **edge-triggered**: it acts on the event "a worker died", not on the state of the fleet. First reset to three workers, then save and start it in a **second terminal**:

```bash
docker rm -f $(docker ps -aq --filter label=cnlab.role=wallet-worker) >/dev/null; ./start-workers.sh 3
```

```bash
cat > edge.sh <<'EOF'
#!/usr/bin/env bash
# edge.sh - the edge-triggered way: react to each "die" event, one replacement per event
docker events --filter label=cnlab.role=wallet-worker --filter event=die --format '{{.Actor.Attributes.name}}' |
while read -r dead; do
  echo "$(date +%T) $dead died, starting one replacement"
  docker rm -f "$dead" >/dev/null; ./start-workers.sh 1
done
EOF
chmod +x edge.sh && ./edge.sh
```

In the first terminal, crash one worker and look:

```bash
docker kill $(W | head -1 | cut -d' ' -f1); sleep 4; W | wc -l
```

```text
ww-29835
3
```

The second terminal printed `ww-29835 died, starting one replacement`, and the fleet is back to three. It works, as long as the script is running at the moment of the death. Stop it with Ctrl+C in the second terminal, kill another worker, and start the script again:

```bash
docker kill $(W | head -1 | cut -d' ' -f1); sleep 1; W
# now start ./edge.sh again in the second terminal, wait 5 s, then:
W
```

```text
ww-32111 exited
ww-22159 running
ww-10762 running
```

The script printed nothing, and one worker stays dead for good. The death happened while nobody was listening, and an event is never repeated. This is the failure Chapter 3.3 calls edge-triggered, and it is exactly what a restart, a dropped connection or a full buffer does to a real controller. Stop the script (Ctrl+C) and remove the old workers before Part C:

```bash
docker rm -f $(docker ps -aq --filter label=cnlab.role=wallet-worker) >/dev/null
```

## Part B: write the goal down

The desired state is one key in etcd: a number. Write it with the helper `e` from Part A and read it back:

```bash
e put /wallet/desired 3
e get /wallet/desired
```

```text
OK
/wallet/desired
3
```

Nothing runs yet. A goal is only a record; something must act on it.

## Part C: the reconcile loop

Save the controller. It follows the four steps of the chapter's drawing: read the goal (`desired`), observe the world (`observe`), find the difference and act on it (`reconcile`), then wait. It reaches etcd through the JSON gateway on the ports from Lab 3.2 (22791 to 22793), tries each member in turn, and owns only containers that carry the label `cnlab.role=wallet-worker`.

```python
#!/usr/bin/env python3
# controller.py --interval S [--events] - keep /wallet/desired wallet workers running.
import argparse, base64, json, random, subprocess, threading, time, urllib.request

PORTS = [22791, 22792, 22793]            # etcd client ports from Lab 3.2
LABEL = "cnlab.role=wallet-worker"       # the controller owns only containers with this label
KEY = "/wallet/desired"

def desired():
    """Read the goal from etcd; try each member. Raises if none answers with a quorum."""
    body = json.dumps({"key": base64.b64encode(KEY.encode()).decode()}).encode()
    for port in PORTS:
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/v3/kv/range", body)
            kvs = json.load(urllib.request.urlopen(req, timeout=2)).get("kvs")
            return int(base64.b64decode(kvs[0]["value"])) if kvs else None
        except Exception:
            continue
    raise RuntimeError("etcd unreadable")

def observe():
    """Return (running names, not-running names) for containers we own."""
    out = subprocess.run(["docker", "ps", "-a", "--filter", f"label={LABEL}", "--format",
                          "{{.Names}} {{.State}}"], capture_output=True, text=True).stdout
    rows = [l.split() for l in out.splitlines()]
    return [n for n, s in rows if s == "running"], [n for n, s in rows if s != "running"]

def start():
    name = f"ww-{random.randrange(16**6):06x}"
    subprocess.run(["docker", "run", "-d", "--label", LABEL, "--name", name, "--net", "cnlab-vol3",
                    "-e", "DATABASE_URL=postgresql://wallet:wallet@pg:5432/wallet",
                    "wallet:v1", "python3", "worker.py"], capture_output=True)
    return name

def reconcile(want):
    running, dead = observe()
    if dead:
        subprocess.run(["docker", "rm", "-f", *dead], capture_output=True)
    have = len(running)
    if have < want:
        print(f"{time.strftime('%T')} want={want} have={have} -> start {[start() for _ in range(want - have)]}", flush=True)
    elif have > want:
        print(f"{time.strftime('%T')} want={want} have={have} -> remove {running[want:]}", flush=True)
        subprocess.run(["docker", "rm", "-f", *running[want:]], capture_output=True)
    else:
        print(f"{time.strftime('%T')} want={want} have={have} ok", flush=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=10)
    ap.add_argument("--events", action="store_true", help="also run a pass at once when a worker dies")
    a = ap.parse_args()
    wake = threading.Event()
    if a.events:
        def watch():
            p = subprocess.Popen(["docker", "events", "--filter", f"label={LABEL}", "--filter", "event=die"],
                                 stdout=subprocess.PIPE, text=True)
            for _ in p.stdout:
                wake.set()
        threading.Thread(target=watch, daemon=True).start()
    want = None                          # last value read from etcd
    while True:
        try:
            want = desired()
        except RuntimeError:
            print(f"{time.strftime('%T')} etcd unreadable, keeping want={want}", flush=True)
        if want is None:
            print(f"{time.strftime('%T')} no goal known yet, doing nothing", flush=True)
        else:
            reconcile(want)
        wake.wait(a.interval); wake.clear()

main()
```

Two details are deliberate. A missing key means "no goal", never "zero workers": the loop does nothing until it has read a value. And `want` keeps its last value when etcd cannot be read; Part E uses that. Start a stranger container that has no label, then run the controller in a **second terminal** with a pass every 2 seconds:

```bash
docker run -d --name stranger --net cnlab-vol3 alpine:3.21 sleep 600 >/dev/null
python3 controller.py --interval 2
```

In the first terminal, crash a worker, stop another politely, delete a third, then change the goal up and down and add one worker by hand. Wait a few seconds after each command so the controller can answer:

```bash
docker kill $(W | head -1 | cut -d' ' -f1)
docker stop $(W | head -1 | cut -d' ' -f1)
docker rm -f $(W | head -1 | cut -d' ' -f1)
e put /wallet/desired 5
e put /wallet/desired 2
./start-workers.sh 1
e put /wallet/desired 3
```

The controller's terminal shows the whole story (your names and times differ):

```text
10:16:52 want=3 have=0 -> start ['ww-498e44', 'ww-4e117e', 'ww-4975ee']
10:17:03 want=3 have=2 -> start ['ww-10818b']
10:17:08 want=3 have=3 ok
10:17:11 want=3 have=2 -> start ['ww-4e8bfd']
10:17:14 want=3 have=3 ok
10:17:17 want=3 have=2 -> start ['ww-b07902']
10:17:22 want=3 have=3 ok
10:17:24 want=5 have=3 -> start ['ww-de1a17', 'ww-0485e2']
10:17:30 want=5 have=5 ok
10:17:34 want=2 have=5 -> remove ['ww-b07902', 'ww-4e117e', 'ww-498e44']
10:17:37 want=2 have=2 ok
10:17:39 want=2 have=3 -> remove ['ww-de1a17']
10:17:42 want=2 have=2 ok
10:17:48 want=3 have=2 -> start ['ww-447f7c']
10:17:52 want=3 have=3 ok
```

Read it as the chapter's three properties. The first line started three workers from nothing: one pass was enough because it acted on the difference. The three deaths (a crash, a stop, a delete) each produced one start, and the `ok` lines between them are passes that found nothing to do, so running a pass twice changes nothing. Changing the goal to 5 and to 2 added and removed workers without any restart of the loop. The worker you started by hand (line `want=2 have=3`) was removed within a pass, because the controller does not care who started a container, only that it carries the label. And the stranger was never touched:

```bash
docker ps --filter name=stranger --format '{{.Names}} {{.Status}}'
```

```text
stranger Up About a minute
```

There is a known weakness: `observe()` treats a failing `docker ps` as "no workers" and would start a whole new fleet. Milestone 3 asks you to fix it. Stop the controller with Ctrl+C and remove the stranger (`docker rm -f stranger`) before Part D.

## Part D: measure how fast it repairs

Chapter 3.3 said that watching for events is only an optimisation of polling. Measure what it buys. `measure.py` starts a controller with the arguments you give it, kills one worker at a random moment of the controller's cycle, and times how long it takes until three workers run again. The random moment matters: a poll-only controller is quick if the kill happens just before its next pass and slow if just after. Make sure the goal is 3 (`e put /wallet/desired 3`), then save:

```python
#!/usr/bin/env python3
# measure.py <trials> <label> <controller args...> - kill one worker N times, time the repair.
import random, subprocess, sys, time

LABEL = "label=cnlab.role=wallet-worker"
def running():
    out = subprocess.run(["docker", "ps", "--filter", LABEL, "--filter", "status=running", "--format", "{{.Names}}"],
                         capture_output=True, text=True).stdout.split()
    return out

trials, label, args = int(sys.argv[1]), sys.argv[2], sys.argv[3:]
interval = float(args[args.index("--interval") + 1])
subprocess.run(["docker", "rm", "-f", *subprocess.run(["docker", "ps", "-aq", "--filter", LABEL],
               capture_output=True, text=True).stdout.split()], capture_output=True)
ctl = subprocess.Popen(["python3", "controller.py", *args], stdout=subprocess.DEVNULL)
while len(running()) < 3: time.sleep(0.2)
print("label,trial,recovery_ms")
try:
    for n in range(1, trials + 1):
        time.sleep(3 + random.uniform(0, interval))   # land at a random point of the controller's cycle
        victim = running()[0]
        t0 = time.monotonic()
        subprocess.run(["docker", "kill", victim], capture_output=True)
        while len(running()) < 3: time.sleep(0.05)
        print(f"{label},{n},{(time.monotonic() - t0) * 1000:.0f}", flush=True)
finally:
    ctl.terminate()
```

Run three settings, ten kills each: a controller that polls every 10 s, one that polls every 2 s, and one that polls every 10 s but also wakes at once on a `die` event (`--events`). Stop any controller you left running first. The whole run takes about 8 minutes:

```bash
cat > run-measure.sh <<'EOF'
#!/usr/bin/env bash
echo "label,trial,recovery_ms" > recovery.csv
python3 measure.py 10 "poll 10 s" --interval 10 | tail -n +2 >> recovery.csv
python3 measure.py 10 "poll 2 s" --interval 2 | tail -n +2 >> recovery.csv
python3 measure.py 10 "events + poll 10 s" --interval 10 --events | tail -n +2 >> recovery.csv
EOF
chmod +x run-measure.sh && ./run-measure.sh
head -4 recovery.csv
```

```text
label,trial,recovery_ms
poll 10 s,1,7821
poll 10 s,2,6163
poll 10 s,3,16311
```

Summarise it (setting, kills, minimum, median, maximum in milliseconds):

```bash
python3 - <<'EOF'
import csv, statistics as st
d = {}
for r in csv.DictReader(open('recovery.csv')): d.setdefault(r['label'], []).append(int(r['recovery_ms']))
for k, v in d.items(): print(k, len(v), min(v), round(st.median(v)), max(v))
EOF
```

```text
poll 10 s 10 6163 9207 17785
poll 2 s 10 2299 4882 7022
events + poll 10 s 10 1783 2588 6666
```

{{diagram lab-3-3-02.jsx | measured with measure.py · 30 kills, 3 controller settings, 3 workers}}

The chart shows three things. First, the poll interval is a large part of the repair time: the median falls from 9.2 s to 4.9 s when the poll runs five times as often, and to 2.6 s when a death wakes the loop at once. Second, the interval is a wait between passes, not a ceiling: three of the ten repairs at the 10 s setting took longer than 10 s, because a kill that lands just after a pass starts must wait for that pass to finish, then for the next one, and a pass takes seconds when Docker is slow. Third, even the best setting needs 1.8 s, which is the cost of `docker ps`, `docker rm` and `docker run` on this machine, and three of its ten repairs took 5 to 7 s. We did not investigate those three; a loaded Docker daemon is the likely cause. Polling every 2 s costs five times the `docker ps` calls of polling every 10 s and still loses to the event hint, which costs one open stream. The 10 s poll stays in the third setting as the guarantee: Part E and Review 3.3 question 7 show why.

## Part E: take away etcd's majority

Chapter 3.3 said a good controller keeps what already runs running when it cannot read its goal. Test it. Leave the controller running in the second terminal with `python3 controller.py --interval 2 --events`, and remove etcd's majority from the first terminal, as you did in Lab 3.2. Then try to change the goal, and kill a worker:

```bash
docker stop etcd2 etcd3; sleep 4
e --command-timeout=3s put /wallet/desired 9 2>&1 | grep -v '^{"level"'
docker kill $(W | head -1 | cut -d' ' -f1); sleep 10; W | wc -l
```

```text
Error: context deadline exceeded
ww-447f7c
3
```

The goal cannot be changed: etcd has no majority, so the `put` fails. But the fleet was repaired anyway. The controller's terminal shows why:

```text
10:21:22 etcd unreadable, keeping want=3
10:21:26 etcd unreadable, keeping want=3
10:21:30 etcd unreadable, keeping want=3
10:21:31 want=3 have=2 -> start ['ww-7f2715']
10:21:35 etcd unreadable, keeping want=3
```

The loop could not read `/wallet/desired`, so it acted on the last value it had read, 3. That is the chapter's static stability, and it is a CAP choice one level up: the controller chose to stay available with a possibly stale goal instead of stopping. Now remove its memory. Stop the controller with Ctrl+C, start it again while etcd is still down, and kill a worker:

```bash
docker kill $(W | head -1 | cut -d' ' -f1); sleep 6; W
```

```text
ww-7f2715
ww-7f2715 exited
ww-14879 running
ww-0485e2 running
```

```text
10:21:41 etcd unreadable, keeping want=None
10:21:41 no goal known yet, doing nothing
10:21:45 etcd unreadable, keeping want=None
10:21:45 no goal known yet, doing nothing
```

A fresh controller has no last value, so it refuses to guess and does nothing; the dead worker stays dead. Choosing "do nothing" over "assume zero" is deliberate: the other choice would have removed your whole fleet. Bring the majority back, and the loop repairs the worker within a pass:

```bash
docker start etcd2 etcd3; sleep 12; W | wc -l
```

```text
3
```

In the controller's terminal the line `want=3 have=2 -> start` appears a few seconds after etcd answers again (it needs a leader first, as in Lab 3.2 Part D).

## Checkpoint

Compare your results with these. Names, times and digits will differ; the pattern must match.

| Check | Expected |
| --- | --- |
| `./start-workers.sh 3` run twice, then `W \| wc -l` | 6: the script ignores what exists |
| `edge.sh` restarted after a kill it missed | Prints nothing; `W` still shows an `exited` worker |
| `e get /wallet/desired` | Prints `/wallet/desired` and `3` |
| Controller log after `docker kill`, `docker stop` and `docker rm -f` of a worker | Each death gives one `want=3 have=2 -> start [...]` line, then `ok` |
| `e put /wallet/desired 5`, then `2` | `-> start` two workers, then `-> remove` three, then `ok` |
| A worker started by hand with `start-workers.sh 1` | Removed at the next pass (`have=3 -> remove`) |
| `docker ps --filter name=stranger` | Still `Up`: unlabelled containers are never touched |
| `recovery.csv` summary | Medians fall from about 9 s (poll 10 s) to about 5 s (poll 2 s) to about 2.6 s (events); the 10 s setting has some values above 10 s |
| Part E with two etcd members stopped | `put` fails; the controller prints `keeping want=3` and still repairs a killed worker |
| Part E with a fresh controller during the outage | `no goal known yet, doing nothing`; the killed worker stays dead until etcd returns |
| Break it, count samples | 4 appears in the running-worker count for several seconds, then 3 |

## Break it

A controller is safe to restart and to run again, but not to run twice at once. **Predict first:** if two copies of this controller watch the same fleet and one worker dies, how many workers exist afterwards, and does the fleet settle at 3? Then try. Restore etcd first (`docker start etcd2 etcd3` if you stopped them), make sure the goal is 3 and exactly three workers run, then save a sampler that counts running workers twice a second:

```bash
cat > count.py <<'EOF'
#!/usr/bin/env python3
# count.py <seconds> - print "elapsed_s,running_workers" every 0.5 s
import subprocess, sys, time
t0 = time.monotonic()
print("t_s,running")
while time.monotonic() - t0 < float(sys.argv[1]):
    n = len(subprocess.run(["docker", "ps", "-q", "--filter", "label=cnlab.role=wallet-worker", "--filter", "status=running"],
                           capture_output=True, text=True).stdout.split())
    print(f"{time.monotonic() - t0:.1f},{n}", flush=True)
    time.sleep(0.5)
EOF
chmod +x count.py
```

Start two copies in the background, both with `--events`, so that one death wakes both at the same instant. Sample for a minute and kill one worker 6 s after sampling starts:

```bash
(python3 controller.py --interval 10 --events > fight-A.log 2>&1 &)
(python3 controller.py --interval 10 --events > fight-B.log 2>&1 &)
sleep 12
(python3 count.py 60 > fight.csv &)
sleep 6; docker kill $(W | head -1 | cut -d' ' -f1); sleep 54
grep -v ' ok$' fight-A.log; grep -v ' ok$' fight-B.log
```

```text
10:11:46 want=3 have=2 -> start ['ww-6d3097']
10:11:59 want=3 have=4 -> remove ['ww-948874']
10:11:46 want=3 have=2 -> start ['ww-d71365']
10:11:59 want=3 have=4 -> remove ['ww-948874']
```

{{diagram lab-3-3-03.jsx | measured with count.py · 65 samples, 2 controllers, 1 worker death}}

Read the two logs against the chart. At 10:11:46 both copies saw `have=2` and both started a worker, so the fleet grew to four, one more than anyone asked for. Neither copy knew the other existed. Thirteen seconds later, at the next pass, both saw `have=4` and both removed a worker. They happened to choose the same one (`ww-948874`, because `docker ps` lists in the same order for both), so the fleet settled at 3. A small difference would have broken that luck: if the two copies had removed different workers, the fleet would have dropped to 2 and both would have started more again. The overshoot cost nothing here only because the extra worker is harmless (`FOR UPDATE SKIP LOCKED` keeps two workers from taking one transfer). A controller that promotes a database or moves money would not be so forgiving; Chapter 3.1's GitHub incident is two actors, each sure it was in charge.

**Diagnose and write down:** which sentence of Chapter 3.3 explains why running two copies is wrong, what the chapter recommends, and which Lab 3.2 mechanism you would build it from. Milestone 3 asks you to build it, and to measure what your fix guarantees.

## Clean up

Stop the controllers and remove everything this lab created. Keep `recovery.csv` and `fight.csv`: Milestone 3 asks for their numbers.

```bash
for p in $(ps -eo pid,args | awk '$2=="python3" && $3=="controller.py" {print $1}'); do kill $p; done
docker rm -f $(docker ps -aq --filter label=cnlab.role=wallet-worker) stranger etcd1 etcd2 etcd3 pg 2>/dev/null
docker network rm cnlab-vol3   # only if no other container uses it
```
