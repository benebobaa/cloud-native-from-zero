# Milestone 3 · A Self-Healing Wallet

## What you deliver

Milestone 3 turns your Lab 3.3 loop into a service you can defend: a controller that keeps N wallet workers alive, survives its own death and a loss of etcd, and comes with a written analysis built from your own measurements. You submit code, three data files and a short analysis. Allow one week: about 2 hours to build, 3 hours to measure and 1 hour to write.

{{diagram milestone-3-01.jsx | Milestone 3 target · 2 controller copies, 1 lease, 3 faults}}

Read the drawing as the contract. Copy A leads and is the only one that touches Docker. Copy B waits and takes over if the lease expires. The three marked faults are the ones you must survive and then explain.

## Requirements

Start from your Lab 3.3 `controller.py`. Everything below must hold on your own laptop, with the Lab 3.2 etcd cluster and the Lab 3.1 Postgres and API.

| # | Requirement | How it is checked |
| --- | --- | --- |
| R1 | The controller keeps the number of labelled workers equal to `/wallet/desired`, and follows changes (3, then 5, then 2) | Controller log, and `accept.sh` below |
| R2 | A failed observation is never read as "no workers", and a missing or unreadable goal is never read as "zero". On a failed `docker ps` the pass is skipped | The `fakebin` test below: no `start` or `remove` line appears |
| R3 | Two copies run together; exactly one acts. Leadership is a lease on `/wallet/controller-leader` created with an etcd transaction (Lab 3.2 Part C) | Logs of both copies; one says it is leader, the other waits |
| R4 | After `kill -9` of the leader copy, the other copy takes over and repairs a killed worker. After the leader loses etcd it stops acting by itself within a renew deadline that is shorter than the lease TTL | `failover.csv`; log line of the step-down |
| R5 | The controller still holds the fleet through a loss of etcd's majority for as long as its lease allows (static stability), and never starts or removes workers on a guess | Part of the analysis, evidence from your logs |
| R6 | Your measurements are your own: `recovery.csv`, `failover.csv`, `fight.csv` | Files, plus the commands that made them |
| R7 | A written partition analysis of at most two pages | Rubric below |
| R8 | `accept.sh` prints `PASS` while workers are killed during the run, and everything is cleaned up afterwards | Output pasted into the analysis |

To test R2 you need a fake `docker` that fails only for `ps`. Put it first in `PATH` for one controller run:

```bash
mkdir -p fakebin
REAL=$(command -v docker)
cat > fakebin/docker <<EOF
#!/usr/bin/env bash
[ "\$1" = ps ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
exec $REAL "\$@"
EOF
chmod +x fakebin/docker
PATH=$PWD/fakebin:$PATH python3 controller.py --interval 2
```

The Lab 3.3 controller fails this test: it prints `want=3 have=0 -> start` and adds three workers. Yours must print only a line saying it skipped the pass. `accept.sh` is the acceptance test. It creates two accounts, sends 60 transfers while killing a worker after every 20, waits for them to settle, and checks the money. Run it with your controller running (API on port 28180 as in Lab 3.1):

```bash
cat > accept.sh <<'EOF'
#!/usr/bin/env bash
# accept.sh - Milestone 3 acceptance test: transfers keep settling exactly once while workers are killed.
URL=http://localhost:28180
j() { curl -fsS -H 'Content-Type: application/json' "$@"; }
bal() { j $URL/accounts/$1 | python3 -c 'import json,sys; print(json.load(sys.stdin)["balance"])'; }
RUN=$RANDOM
j -X POST $URL/accounts -d "{\"name\":\"a$RUN\",\"balance\":1000}" >/dev/null
j -X POST $URL/accounts -d "{\"name\":\"b$RUN\",\"balance\":1000}" >/dev/null
for i in $(seq 60); do
  j -X POST $URL/transfers -d "{\"id\":\"t$RUN-$i\",\"from\":\"a$RUN\",\"to\":\"b$RUN\",\"amount\":10}" >/dev/null
  if [ $((i % 20)) -eq 0 ]; then docker kill "$(docker ps -q --filter label=cnlab.role=wallet-worker | head -1)" >/dev/null; fi
done
for _ in $(seq 60); do
  pending=$(for i in $(seq 60); do j $URL/transfers/t$RUN-$i | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])'; done | grep -c pending)
  [ "$pending" -eq 0 ] && break; sleep 1
done
A=$(bal a$RUN); B=$(bal b$RUN)
echo "pending=$pending a=$A b=$B workers=$(docker ps -q --filter label=cnlab.role=wallet-worker | wc -l)"
[ "$pending" -eq 0 ] && [ "$A" -eq 400 ] && [ "$B" -eq 1600 ] && echo PASS || echo FAIL
EOF
chmod +x accept.sh && ./accept.sh
```

```text
pending=0 a=400 b=1600 workers=3
PASS
```

The output was produced with the Lab 3.3 controller running; the three kills were repaired, as the final value `workers=3`.

## Measurements to submit

Three CSV files, each produced by commands you can show. Do not copy the numbers from the labs.

| File | How you make it | Minimum |
| --- | --- | --- |
| `recovery.csv` | Lab 3.3 Part D with your final controller, at least two settings (a poll-only run and a run with `--events`) | 10 kills per setting |
| `failover.csv` | A script of yours: start both copies, `kill -9` the leader copy, record the seconds until the other copy logs that it leads; repeat | 5 trials |
| `fight.csv` | Lab 3.3 Break it with your leader election **off** (two copies without the lease), then repeat with it **on** and show the difference | 1 run each |

## The partition analysis

One to two pages, plain text or Markdown, called `analysis.md`. Every number in it must come from your files or logs. It answers six questions, in this order:

1. **What did you inject?** For each of the three faults on the drawing, name the failure model from Chapter 3.1's table (crash-stop, omission, timing and so on) and the exact command.
2. **What did each part choose?** For etcd and for your controller, say whether it chose consistency or availability while etcd had no majority, and show the log lines that prove it. Place both on the PACELC grid and give one reason each.
3. **What is your longest window with no repair, and your longest window with two actors?** Give both in seconds and derive each from your lease TTL, renew deadline and poll interval; then compare with `failover.csv` and `fight.csv`. If they disagree, say why.
4. **What happens to a worker that dies during each fault?** One sentence per fault: repaired, repaired late, or not repaired until something returns.
5. **What would break at production scale?** Move etcd to five members across three zones. State what the loss of one zone does to your controller, using quorum arithmetic from Chapter 3.2.
6. **What did you not test?** One honest gap, and how you would test it.

## Grading rubric

The milestone is worth 100 points. Pass: at least 60 points and more than zero on both R3 and the analysis.

| Criterion | Points | Full marks when |
| --- | --- | --- |
| R1 Reconciliation | 15 | The fleet follows 3, 5 and 2; passes are no-ops when nothing differs; unlabelled containers are never touched |
| R2 Safe observation | 10 | The `fakebin` test starts and removes nothing; a missing goal does nothing |
| R3 Leader election | 15 | One copy acts, the other waits; the lease is created in one transaction; both logs show it |
| R4 Failover and step-down | 10 | `kill -9` of the leader leads to a takeover; a leader without etcd stops acting before its lease can expire |
| R5 Static stability | 5 | The log shows the fleet held and repaired within the allowed window during a loss of majority |
| R6 Data | 10 | Three files, own runs, commands shown, summary numbers match the files |
| R7 Analysis | 30 | Six questions answered; numbers traceable; the two windows derived and compared with data; the CAP and PACELC placement argued, not just labelled |
| R8 Acceptance and clean-up | 5 | `PASS` shown; no containers or networks left behind |

## Stretch (not graded)

Give every command a fencing token: put the lease's revision in each container's label, and make the controller refuse to remove a container labelled with a higher token than its own. Explain in two sentences what failure of Chapter 3.1 this prevents. Then map your design to Kubernetes: which object is your `/wallet/desired`, which is your lease (`kubectl get lease -n kube-system`), and which program plays your leader copy?
