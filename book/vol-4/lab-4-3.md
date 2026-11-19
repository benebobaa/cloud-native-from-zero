# Lab 4.3 · The Wallet Stack with Compose

## Goal

You will run the wallet as three containers with Compose and prove, with numbers, what each setting does: names on a network, a volume that survives, limits that kill or throttle, a health check that only labels, and a restart policy that only reacts to an exit.

**Versions tested** (2026-11-17, Docker Desktop on WSL2, Ubuntu 26.04): Docker Engine 29.9.2, Docker Compose v5.6.1, `postgres:17`, `wallet:alpine` built from `Dockerfile.alpine` (Lab 4.1; Python 3.12 on Alpine, psycopg 3.2.3), `alpine`, cgroup v2. **Not run:** Docker Engine installed natively with `apt` on Ubuntu 24.04, `docker compose` profiles, and swap limits. The test machine was busy with other jobs while the timings were taken, so your health check timings in Part E will differ by a few seconds.

**Before you start:** the `wallet/` folder in `~/cn-lab/wallet` with `Dockerfile.alpine` and `test_e2e.sh` (Vols 3 and 4), `wallet:alpine` from Lab 4.1, Docker with Compose v2, about 2 GB of free disk and 1 GB of free RAM. The lab publishes only `127.0.0.1:18080` and removes everything it creates.

### What you will build

{{diagram lab-4-3-01.jsx | what you will build in Lab 4.3 · one panel per part}}
## Part A · Names on a network, and the start-order race

You will start a database by hand, watch a client fail because it came too early, and see that only a user-defined network can resolve names.

**Step 1: a client that comes too early.**

```bash
docker network create lab43-net
docker run -d --name lab43-db --network lab43-net -e POSTGRES_USER=wallet -e POSTGRES_PASSWORD=wallet -e POSTGRES_DB=wallet postgres:17
docker run --rm --network lab43-net postgres:17 psql postgresql://wallet:wallet@lab43-db/wallet -c 'select 1'
s=$(date +%s); until docker exec lab43-db pg_isready -U wallet -d wallet >/dev/null 2>&1; do sleep 0.5; done; echo "ready after $(( $(date +%s)-s ))s"
docker run --rm --network lab43-net postgres:17 psql postgresql://wallet:wallet@lab43-db/wallet -tc 'select 1'
```

```text
psql: error: connection to server at "lab43-db" (172.25.0.2), port 5432 failed: Connection refused
	Is the server running on that host and accepting TCP/IP connections?
ready after 4s
        1

```

The container was running, yet the database refused the first connection. About four seconds passed before `pg_isready` said yes. That gap is what `depends_on: condition: service_healthy` waits out. The wallet's own `db.connect()` retries for 30 seconds, so it would have survived; `psql` does not retry.

**Step 2: names exist only on a user-defined network.**

```bash
docker run --rm alpine ping -c1 -W2 lab43-db
docker run --rm --network lab43-net alpine sh -c 'ping -c1 lab43-db | head -2; grep nameserver /etc/resolv.conf; ip -4 addr show eth0 | grep inet; ip route'
docker network inspect lab43-net -f '{{range .IPAM.Config}}{{.Subnet}} {{.Gateway}}{{end}}'
```

```text
ping: bad address 'lab43-db'
PING lab43-db (172.25.0.2): 56 data bytes
64 bytes from 172.25.0.2: seq=0 ttl=64 time=0.456 ms
nameserver 127.0.0.11
    inet 172.25.0.3/16 brd 172.25.255.255 scope global eth0
default via 172.25.0.1 dev eth0
172.25.0.0/16 dev eth0 scope link  src 172.25.0.3
172.25.0.0/16 172.25.0.1
```

On the default bridge the name does not resolve (`bad address`). On `lab43-net` it resolves to `172.25.0.2` through the resolver at `127.0.0.11`, and the container sees an ordinary network: an address in `172.25.0.0/16`, a default route through the bridge's gateway `172.25.0.1`. Your subnet will differ.

Clean up: `docker rm -f lab43-db && docker network rm lab43-net`.

Answer in your notes: (1) Why did the first `psql` fail although `docker run -d` had succeeded? (2) Which line of output proves that the name `lab43-db` is answered by Docker and not by your router? (3) Which two Compose features would you combine to make this race disappear, and why would you still keep retries in the client?

## Part B · Compose the wallet

You will write the stack file, start the wallet's three services with one command, run the wallet's own test against it, and read back every setting from the kernel.

**Step 1: write the file.** Save this as `~/cn-lab/wallet/compose.stack.yaml`. Part 5 of the chapter explains each block; the two `healthcheck` commands are the ones from part 4.

```yaml
name: wallet-stack

x-wallet: &wallet
  image: wallet:alpine
  restart: unless-stopped
  stop_grace_period: 10s
  read_only: true
  tmpfs: [/tmp]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  networks: [backend]
  environment:
    DATABASE_URL: postgresql://wallet:${DB_PASSWORD:?set DB_PASSWORD in .env}@postgres:5432/wallet
  depends_on:
    postgres: {condition: service_healthy}
  logging:
    driver: json-file
    options: {max-size: 10m, max-file: "3"}

services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: wallet
      POSTGRES_PASSWORD: ${DB_PASSWORD:?set DB_PASSWORD in .env}
      POSTGRES_DB: wallet
    volumes: [pgdata:/var/lib/postgresql/data]
    networks: [backend]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "wallet", "-d", "wallet"]
      interval: 5s
      timeout: 3s
      retries: 10
    deploy:
      resources:
        limits: {memory: 256M, cpus: "1.0"}

  api:
    <<: *wallet
    build: {context: ., dockerfile: Dockerfile.alpine}
    ports: ["127.0.0.1:${API_PORT:-8080}:8080"]
    networks: [backend, frontend]
    healthcheck:
      test: ["CMD", "python3", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:8080/readyz', timeout=4)"]
      interval: 5s
      timeout: 5s
      retries: 3
      start_period: 5s
    deploy:
      resources:
        limits: {memory: 128M, cpus: "0.5"}

  worker:
    <<: *wallet
    command: ["python3", "worker.py"]
    healthcheck:
      test: ["CMD", "python3", "-c", "import db; db.connect().execute('SELECT 1')"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 5s
    deploy:
      resources:
        limits: {memory: 128M, cpus: "0.5"}

volumes:
  pgdata:

networks:
  backend: {internal: true}   # no route to the internet
  frontend: {}                # only the api joins it, to publish its port
```

The same file ships as `wallet/compose.stack.yaml` in the course repository; type it once anyway, because writing a file teaches more than reading it.

**Step 2: see that a missing secret stops Compose.** The file requires `DB_PASSWORD`, which does not exist yet.

```bash
cd ~/cn-lab/wallet
docker compose -f compose.stack.yaml config -q 2>&1 | head -1
```

```text
error while interpolating services.api.environment.DATABASE_URL: required variable DB_PASSWORD is missing a value: set DB_PASSWORD in .env
```

The service named in the message may differ on your run. Now create the `.env` file that Compose reads. It stays out of images because the `.dockerignore` of Lab 4.1 sends only `app/` to the builder.

```bash
printf 'DB_PASSWORD=change-me-please\nAPI_PORT=18080\n' > .env
```

**Step 3: start the stack and test it.**

```bash
docker compose -f compose.stack.yaml up -d --build
sleep 25
docker compose -f compose.stack.yaml ps --format 'table {{.Service}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
./test_e2e.sh http://127.0.0.1:18080
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}\t{{.PIDs}}' | grep -E 'NAME|wallet-stack'
```

```text
 Container wallet-stack-postgres-1 Healthy
 Container wallet-stack-worker-1 Started
 Container wallet-stack-api-1 Started
SERVICE    IMAGE           STATUS                    PORTS
api        wallet:alpine   Up 26 seconds (healthy)   127.0.0.1:18080->8080/tcp
postgres   postgres:17     Up 39 seconds (healthy)   5432/tcp
worker     wallet:alpine   Up 27 seconds (healthy)   8080/tcp
transfer=settled big=rejected alice=70 bob=80
PASS
NAME                      MEM USAGE / LIMIT     CPU %     PIDS
wallet-stack-api-1        23.16MiB / 128MiB     0.02%     1
wallet-stack-worker-1     55.15MiB / 128MiB     49.90%    2
wallet-stack-postgres-1   50.85MiB / 256MiB     9.38%     7
```

The wallet passes its own end-to-end test, now as three containers with their start order enforced by the health check. The worker row shows two processes and extra memory because `docker stats` happened to run while the worker's health check was running; at rest it holds one process and about 25 MiB. The `Ports` column shows that only the API is published, and only on `127.0.0.1`.

**Step 4: read the settings back from Docker and from the kernel.**

```bash
for s in api worker postgres; do docker inspect wallet-stack-$s-1 -f '{{.Name}} mem={{.HostConfig.Memory}} cpus={{.HostConfig.NanoCpus}} ro={{.HostConfig.ReadonlyRootfs}} cap_drop={{.HostConfig.CapDrop}} restart={{.HostConfig.RestartPolicy.Name}}'; done
docker exec wallet-stack-worker-1 sh -c 'id -u; touch /app/x 2>&1; touch /tmp/ok && echo "/tmp writable"; cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/cpu.max; grep -E "^(CapBnd|NoNewPrivs)" /proc/self/status'
docker run --rm wallet:alpine sh -c 'grep -E "^(CapBnd|NoNewPrivs)" /proc/self/status'
docker exec wallet-stack-worker-1 python3 -c "
import urllib.request as u
try: u.urlopen('http://1.1.1.1', timeout=3)
except Exception as e: print('worker, no internet:', e)"
docker network inspect wallet-stack_backend -f 'internal={{.Internal}}'
```

```text
/wallet-stack-api-1 mem=134217728 cpus=500000000 ro=true cap_drop=[ALL] restart=unless-stopped
/wallet-stack-worker-1 mem=134217728 cpus=500000000 ro=true cap_drop=[ALL] restart=unless-stopped
/wallet-stack-postgres-1 mem=268435456 cpus=1000000000 ro=false cap_drop=<no value> restart=unless-stopped
10001
touch: /app/x: Read-only file system
/tmp writable
134217728
50000 100000
CapBnd:	0000000000000000
NoNewPrivs:	1
CapBnd:	00000000a80425fb
NoNewPrivs:	0
worker, no internet: <urlopen error [Errno 101] Network unreachable>
internal=true
```

Every line of the Compose file has a witness. `memory.max` is `134217728`, which is 128 MiB, and `cpu.max` is `50000 100000`, half a CPU. The container runs as user `10001`, cannot write `/app` but can write `/tmp`, has an empty capability bounding set (compare the plain `docker run`, which still has `00000000a80425fb`) and `NoNewPrivs: 1`. The worker has no route to the internet. The Postgres container keeps Docker's defaults for the privilege settings, because the file does not restrict it.

Answer in your notes: (1) Which two lines of the output show the 128 MiB limit, one from Docker and one from the kernel? (2) Why does only the API appear under `Ports`? (3) The worker is on the `backend` network only: which line proves it cannot reach the internet, and how would the API differ?

## Part C · Volumes: what survives

You will write data, remove the containers, and find out which removal keeps the data and which destroys it.

The end-to-end test in Part B created the account `alice` with a balance of 70. Remove the containers and networks, check that the volume is still there, start again and read the account:

```bash
cd ~/cn-lab/wallet
curl -s localhost:18080/accounts/alice
docker compose -f compose.stack.yaml down
docker volume ls --format '{{.Name}}' | grep wallet-stack
docker compose -f compose.stack.yaml up -d >/dev/null 2>&1; sleep 30
curl -s localhost:18080/accounts/alice
```

```text
{"name": "alice", "balance": 70}
 Container wallet-stack-api-1 Removed
 Container wallet-stack-worker-1 Removed
 Container wallet-stack-postgres-1 Removed
 Network wallet-stack_backend Removed
 Network wallet-stack_frontend Removed
wallet-stack_pgdata
{"name": "alice", "balance": 70}
```

The containers are new (their IDs changed), but the data is the same: it lived in `wallet-stack_pgdata`, not in a container. Now remove the volume too:

```bash
docker compose -f compose.stack.yaml down -v 2>&1 | grep -E 'Volume'
docker compose -f compose.stack.yaml up -d >/dev/null 2>&1; sleep 30
curl -s localhost:18080/accounts/alice
```

```text
 Volume wallet-stack_pgdata Removed
{"error": "no such account"}
```

The stack comes back healthy and empty. Nothing in Compose asked you to confirm: `-v` deleted the database. In your notes, write the rule you will follow in a real environment.

Answer in your notes: (1) Which of the four storage kinds in part 2 did this stack use for the database, and which did it use for `/tmp` in the API and worker? (2) After `docker compose down`, the container IDs changed but the balance did not: where did the balance live? (3) A teammate runs `docker compose down -v` "to clean up" on the shared test stack. What did they delete, and what would you add to the team's process to prevent it?

## Part D · Limits, measured

You will push one container past a memory limit and another past a CPU limit, record what the kernel does, and compare it with the chart.

**Step 1: a memory hog.** The program allocates 4 MiB every quarter second and prints how much it asked for and how much its cgroup holds. Run it with a 64 MiB limit and `--memory-swap` equal to it, so no swap can hide the effect.

```bash
cd ~/cn-lab
cat > hog.py <<'PY'
import time
held = []
while True:
    held.append(b"x" * (4 * 1024 * 1024))
    cur = int(open("/sys/fs/cgroup/memory.current").read()) // 1048576
    print(len(held) * 4, cur, flush=True)
    time.sleep(0.25)
PY
docker run -d --name lab43-oom --memory 64m --memory-swap 64m -v $PWD/hog.py:/hog.py:ro wallet:alpine python3 /hog.py
sleep 12
docker inspect -f 'exit={{.State.ExitCode}} oom={{.State.OOMKilled}} status={{.State.Status}}' lab43-oom
docker logs lab43-oom | tail -4
docker rm lab43-oom
```

```text
exit=137 oom=true status=exited
48 51
52 55
56 59
60 63
```

The two columns are what the program asked for and what its cgroup reported, in MiB. The cgroup is always 3 MiB ahead: that is the Python interpreter itself. After 60 MiB asked for (63 MiB in the cgroup) the next 4 MiB block crossed 64 MiB, the process was killed, and the container exited with status 137 and `OOMKilled=true`.

{{diagram lab-4-3-02.jsx | measured 2026-11-17 in Lab 4.3 Part D, step 1 · 15 readings, rows in data/vol4-oom-64m-2026-11-17.csv}}
The chart is these 15 readings plus the kill. The limit is a wall: memory grows in a straight line, then the process stops existing, with no warning step in between. Your program received no exception; it was killed from outside.

**Step 2: a CPU hog.** The program spins for six seconds and reports how much CPU time its cgroup gave it and how often the kernel throttled it.

```bash
cat > spin.py <<'PY'
import time
def stat():
    d = dict(l.split() for l in open("/sys/fs/cgroup/cpu.stat"))
    return int(d["usage_usec"]), int(d["nr_throttled"])
u0, t0 = stat(); w0 = time.time()
while time.time() - w0 < 6: pass
u1, t1 = stat(); w = time.time() - w0
print(f"{(u1 - u0) / 1e6 / w:.2f} {t1 - t0}")
PY
for l in 0.25 0.5 1.0 none; do if [ $l = none ]; then a=""; else a="--cpus $l"; fi; r=$(docker run --rm $a -v $PWD/spin.py:/spin.py:ro wallet:alpine python3 /spin.py); echo "$l: cores=${r% *} throttled_periods=${r#* }"; done
```

```text
0.25: cores=0.25 throttled_periods=60
0.5: cores=0.50 throttled_periods=60
1.0: cores=0.99 throttled_periods=5
none: cores=0.99 throttled_periods=0
```

{{diagram lab-4-3-03.jsx | measured 2026-11-17 in Lab 4.3 Part D, step 2 · 4 runs of 6 s, rows in data/vol4-cpu-limit-2026-11-17.csv}}
The loop used what the limit allowed: a quarter of a core, half a core, one core. With no limit it used 0.99 cores, not more, because one Python thread can use only one core. Nothing was killed. The kernel accounts CPU in periods of 100 ms (`cpu.max` was `50000 100000` in Part B), so a 6 s run has 60 periods; with 0.25 and 0.5 cores the loop was throttled in all 60 (`nr_throttled`). A CPU limit shows up as slowness, not as an error, which is why teams that watch only error rates miss it.

Answer in your notes: (1) Why is the cgroup reading 3 MiB above what the program asked for? (2) Predict `nr_throttled` for `--cpus 2.0` and the same loop, then say why. (3) A service at 100 MiB average use has a 128 MiB limit and gets killed once an hour: what do you measure before raising the limit?

## Part E · Health and restart

You will take the database away from a running stack, watch what Docker does about it, then stop and kill containers to see when the restart policy acts.

**Step 1: stop Postgres and watch the API.**

```bash
A=wallet-stack-api-1
docker compose -f compose.stack.yaml stop postgres
t0=$(date +%s); for i in $(seq 1 9); do echo "t=$(( $(date +%s)-t0 ))s health=$(docker inspect -f '{{.State.Health.Status}}' $A) running=$(docker inspect -f '{{.State.Running}}' $A) restarts=$(docker inspect -f '{{.RestartCount}}' $A)"; sleep 4; done
curl -s -m3 -w ' http=%{http_code}\n' localhost:18080/healthz
curl -s -m3 -o /dev/null -w 'readyz http=%{http_code}\n' localhost:18080/readyz
```

```text
t=0s health=healthy running=true restarts=0
t=4s health=healthy running=true restarts=0
t=8s health=healthy running=true restarts=0
t=13s health=healthy running=true restarts=0
t=17s health=healthy running=true restarts=0
t=21s health=healthy running=true restarts=0
t=26s health=unhealthy running=true restarts=0
t=31s health=unhealthy running=true restarts=0
t=35s health=unhealthy running=true restarts=0
{"status": "ok"} http=200
readyz http=000
```

About 21 to 26 seconds after the database went away, three failed checks in a row made the API `unhealthy`, and then nothing else happened: it is still running with `restarts=0`. `/healthz` still answers `200` because it does not touch the database, which is why the Compose file checks `/readyz`. The `readyz http=000` means `curl` gave up after 3 seconds. The wallet's `db.connect()` keeps retrying for 30 seconds instead of failing fast, so a probe that waits for an answer waits long. That is a design lesson for your own services: a readiness endpoint should answer quickly, yes or no.

**Step 2: bring Postgres back.**

```bash
docker compose -f compose.stack.yaml start postgres
t0=$(date +%s); for i in $(seq 1 7); do echo "t=$(( $(date +%s)-t0 ))s health=$(docker inspect -f '{{.State.Health.Status}}' $A)"; sleep 4; done
```

```text
t=0s health=unhealthy
t=5s health=unhealthy
t=9s health=healthy
t=13s health=healthy
t=17s health=healthy
t=21s health=healthy
t=25s health=healthy
```

The API became healthy within 9 seconds, with no restart: the process never failed, it only could not reach its database for a while. Your timings will differ by a few seconds.

**Step 3: stop and kill a container.** The restart policy is `unless-stopped`. Watch whether it acts.

```bash
W=wallet-stack-worker-1
s=$(date +%s%N); docker stop $W >/dev/null; e=$(date +%s%N); echo "stop took $(( (e-s)/1000000 )) ms"
docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}}' $W
docker logs --tail 1 $W 2>&1
sleep 5; docker inspect -f '5s later: status={{.State.Status}} restarts={{.RestartCount}}' $W
docker start $W >/dev/null; sleep 4
docker kill $W >/dev/null; sleep 6
docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} restarts={{.RestartCount}}' $W
docker start $W >/dev/null
```

```text
stop took 520 ms
status=exited exit=0
wallet-worker: stopped cleanly
5s later: status=exited restarts=0
status=exited exit=137 restarts=0
```

The worker handles `SIGTERM`, so `docker stop` finished in about half a second with exit status 0 instead of waiting out the 10-second grace period. Neither your `stop` nor your `kill` made the policy start it again: both are manual stops, and the policy ignores them. `docker kill` gave exit status 137 (128 plus signal 9). A restart happens only when the container exits on its own, and you will cause that in Break it.

Answer in your notes: (1) Why did the API stay `running` while `unhealthy`, and what would a Kubernetes liveness probe do differently? (2) What does exit status 0 against 137 tell you about how each container ended? (3) Name one change to the wallet's `/readyz` that would make Step 1's last line print `readyz http=503` instead of `000`.

## Checkpoint

You are done when each row gives the expected result. Commands run in `~/cn-lab/wallet` unless the row says otherwise.

| Check | Command | Expected |
| --- | --- | --- |
| Names resolve only on a user-defined network | Part A, step 2 | `ping: bad address` on the default bridge; a reply on `lab43-net` |
| A client that comes too early is refused | Part A, step 1 | `Connection refused`, then `ready after` a few seconds |
| The stack passes the wallet's test | `./test_e2e.sh http://127.0.0.1:18080` | `PASS` |
| The memory limit reached the kernel | `docker exec wallet-stack-worker-1 cat /sys/fs/cgroup/memory.max` | `134217728` |
| Capabilities and privilege gain are removed | `docker exec wallet-stack-worker-1 grep -E '^(CapBnd\|NoNewPrivs)' /proc/self/status` | `CapBnd:` all zeros and `NoNewPrivs: 1` |
| The worker has no route out | Part B, step 4, the `urlopen` command | `Network is unreachable` |
| The volume survives `down` | Part C | the same balance after `down` and `up`; `no such account` after `down -v` |
| A memory limit kills | Part D, step 1 | `exit=137 oom=true status=exited` |
| A CPU limit throttles | Part D, step 2 | `cores` within 0.05 of the limit for 0.25 and 0.5, and 60 throttled periods |
| Unhealthy is only a label | Part E, step 1 | `health=unhealthy` with `restarts=0` |
| A manual stop or kill is not restarted | Part E, step 3 | `status=exited` after 5 s, and `restarts=0` |
| A real exit is restarted | Break it, part 1 | `oom=true` and `restarts` above 0 |

Clean up when you finish Break it:

```bash
docker compose -f compose.stack.yaml down -v
rm -f .env ~/cn-lab/hog.py ~/cn-lab/spin.py
```

If you stopped after Part A, also run `docker rm -f lab43-db; docker network rm lab43-net`. Keep `wallet:alpine`; Milestone 4 uses it.

## Break it: a limit that is too small, and a password that did not change

Two failures that real teams meet in the first month, caused on purpose.

**Part 1: a memory limit below what the program needs.** Give the worker 20 MiB. It needs about 25.

```bash
W=wallet-stack-worker-1
docker update --memory 20m --memory-swap 20m $W >/dev/null
docker restart $W >/dev/null; sleep 20
docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' $W
docker update --memory 128m --memory-swap 128m $W >/dev/null; sleep 12
docker inspect -f 'fixed: status={{.State.Status}} oom={{.State.OOMKilled}}' $W
```

```text
status=restarting exit=137 oom=true restarts=6
fixed: status=running oom=false
```

The kernel killed the worker on every start, and the restart policy started it again, six times in twenty seconds: this is the restart loop of the production table. Here the policy did act, because the container exited on its own, with status 137. A health check would not have helped: the container never lived long enough to be checked.

**Part 2: change the database password.** Edit `.env`, then apply the change.

```bash
sed -i 's/^DB_PASSWORD=.*/DB_PASSWORD=a-new-password/' .env
docker compose -f compose.stack.yaml up -d >/dev/null 2>&1
sleep 40
docker compose -f compose.stack.yaml ps --format '{{.Service}} {{.Status}}'
docker compose -f compose.stack.yaml logs postgres 2>&1 | grep FATAL | tail -2 | cut -c1-120
docker compose -f compose.stack.yaml logs api 2>&1 | tail -1 | cut -c1-200
curl -s -m 3 -o /dev/null -w 'readyz http=%{http_code}\n' localhost:18080/readyz
```

```text
api Up 3 seconds (health: starting)
postgres Up 51 seconds (healthy)
worker Up 6 seconds (health: starting)
postgres-1  | 2026-11-17 03:46:58.991 UTC [162] FATAL:  password authentication failed for user "wallet"
postgres-1  | 2026-11-17 03:47:00.089 UTC [163] FATAL:  password authentication failed for user "wallet"
api-1  | psycopg.OperationalError: connection failed: connection to server at "172.24.0.2", port 5432 failed: FATAL:  password authentication failed for user "wallet"
readyz http=000
```

Postgres is healthy, because `pg_isready` does not log in, yet the API and the worker cannot authenticate: the API's `Up 3 seconds` means it crashed after its 30 retries and was restarted. The new password was handed to the new containers, but Postgres sets the password only when it creates an empty data directory, and the volume still holds the old one. Restore the old value in `.env` and the stack recovers; or run `docker compose down -v` to start from nothing, which is acceptable only in a throwaway environment.

Answer in your notes: (1) Why is `exit=137` here a sign of a limit that is too small, and which one command in Part D proves it? (2) Why did a healthy database not make the stack work? (3) A colleague proposes `down -v` as the fix in production. What do you propose instead, and what do you check before touching the volume?
