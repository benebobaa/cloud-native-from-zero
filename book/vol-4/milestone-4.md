# Milestone 4 · The Wallet in Containers

## What you deliver

You deliver the wallet as containers: the image you chose after measuring three, and a Compose stack in which every setting is proved by a command. You also write down what a health check does not do. Allow about 3 hours after Lab 4.3.

**Versions tested** (2026-11-17, Docker Desktop on WSL2, Ubuntu 26.04, Docker Engine 29.9.2, Compose v5.6.1): evidence commands 1 to 9 were run against the Lab 4.3 stack with `wallet:alpine` tagged as `wallet:final`; the failure drill of evidence 10 is the one of Lab 4.3 Part E. **Not run:** a stack built on `wallet:slim` or `wallet:distroless` as the final image. If a student chooses distroless, the stack's `command` and health checks must work without a shell; that variant is untested.

{{diagram milestone-4-01.jsx | Milestone 4 · what you hand in}}
Put these files in `~/cn-lab/milestone-4/` and commit them:

| File | What it is |
| --- | --- |
| `Dockerfile.final` and `.dockerignore` | Part 1: the one image you ship |
| `images.csv` | Part 1: the measured sizes of the three images |
| `compose.yaml` | Part 2: the stack |
| `.env.example` | Part 2: the variable names with fake values |
| `evidence.txt` | The output of the ten commands in the evidence table below, in order, each under its number |
| `report.md` | Part 3: your failure drill and 150 to 250 words |

Do not commit `.env`: it holds the real password.

## Part 1 · Measure three images and ship one (45 min)

Build the wallet on the three bases of Lab 4.1, measure each, and decide with numbers.

```bash
mkdir -p ~/cn-lab/milestone-4 && cd ~/cn-lab/wallet
for t in slim alpine distroless; do docker build -q -f Dockerfile.$t -t wallet:$t .; done
for t in slim alpine distroless; do ./measure_image.sh wallet:$t; done
```

Write `images.csv` with the header `image,layers,compressed_bytes,unpacked_bytes` and one row per image, copied from `measure_image.sh`. Then choose:

- The image you ship must be **30,000,000 bytes or less compressed**. On the test machine, `slim` was 48,229,704 bytes and fails; `alpine` (25,430,276) and `distroless` (27,422,225) pass.
- Between the images that pass, choose by what you can operate. Write two sentences in `report.md` that name one thing you gain and one thing you give up (Lab 4.1, part 5).
- Copy the Dockerfile you chose to `Dockerfile.final` and build it as `wallet:final`. It must run as a non-root user, use the `.dockerignore` of Lab 4.1, order its steps for the cache, and put no secret in any layer.

Check the last rule with a planted value: build with your password in `.env`, then `docker save wallet:final | tar -xO | grep -a -c '<your password>'` must print `0`.

## Part 2 · The stack (75 min)

Start from `compose.stack.yaml` of Lab 4.3, save it as `compose.yaml` (the name Compose reads without `-f`), and make it meet every row of this checklist:

| Requirement | Checked by evidence |
| --- | --- |
| Three services; `api` and `worker` use `wallet:final` | 3, 4 |
| `backend` network with `internal: true`; only `api` on `frontend`; the API port published on `127.0.0.1` only | 8 |
| A named volume holds the database | 9 |
| A health check on every service; `api` and `worker` wait for Postgres with `condition: service_healthy` | 3 |
| Memory and CPU limits on every service, with numbers you chose from measurement (use `docker stats` while you run the end-to-end test in a loop) | 5, 6 |
| `restart: unless-stopped` on every service | 5 |
| `api` and `worker`: read-only root with a `tmpfs` for `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, non-root user | 5, 7 |
| The password comes from `.env` and the file refuses to start without it; `.env.example` is committed | 4 |

Run it twice from nothing (`docker compose down -v`, then `docker compose up -d --build`) to prove it is repeatable.

## Part 3 · Failure drill and report (45 min)

Run the drills of Lab 4.3 on your own stack and paste the key lines into `report.md`: Postgres stopped and started again (evidence 10), a worker limit set below its need (exit status 137, `OOMKilled`, restart count), and `down` against `down -v`. Then write 150 to 250 words answering:

*A teammate says: "If a container is unhealthy, Docker will restart it." Correct them using your own output. Say which limit you would loosen first in production and why. Name what your containers still share with the host, and one control from this volume that does not change that.*

## Evidence: ten commands for `evidence.txt`

Run each command once, with the stack up and healthy, and paste its output under its number. `<port>` is your `API_PORT`.

| # | Command | Expected |
| --- | --- | --- |
| 1 | `./measure_image.sh wallet:final` | `compressed=` below `30000000` (`25430276` on the test machine, with the Alpine image) |
| 2 | `docker inspect -f '{{.Config.User}}' wallet:final` | a user that is not empty, `0` or `root` (`10001` for the Alpine image) |
| 3 | `docker compose ps --format 'table {{.Service}}\t{{.Status}}'` | three lines, each ending `(healthy)` |
| 4 | `./test_e2e.sh http://127.0.0.1:<port>` | `PASS` |
| 5 | for each service: `docker inspect <container> -f '{{.Name}} mem={{.HostConfig.Memory}} cpus={{.HostConfig.NanoCpus}} restart={{.HostConfig.RestartPolicy.Name}} ro={{.HostConfig.ReadonlyRootfs}} health={{.State.Health.Status}}'` | mem and cpus not 0 for all three; `restart=unless-stopped`; `ro=true` for `api` and `worker`; `health=healthy` |
| 6 | `docker compose exec -T api python3 -c "print(open('/sys/fs/cgroup/memory.max').read().strip(), open('/sys/fs/cgroup/cpu.max').read().strip())"` | your limits in bytes and microseconds (`134217728 50000 100000` for 128M and 0.5 CPU) |
| 7 | `docker compose exec -T api python3 -c "import re; print(re.findall(r'^(?:CapBnd\|NoNewPrivs):.*$', open('/proc/self/status').read(), re.M)); open('/app/x', 'w')"` | `CapBnd` all zeros, `NoNewPrivs: 1`, then `Read-only file system` |
| 8 | `docker network inspect <project>_backend -f 'backend internal={{.Internal}}'` and `docker ps --format '{{.Names}} {{.Ports}}'` | `internal=true`; only the API shows `127.0.0.1:<port>->8080/tcp` |
| 9 | `curl localhost:<port>/accounts/alice`, `docker compose down`, `docker compose up -d`, wait 30 s, the same `curl` | the same JSON both times; after `down -v` it is `no such account` |
| 10 | stop Postgres, watch the API's `.State.Health.Status` and `.RestartCount` as in Lab 4.3 Part E, start Postgres | `unhealthy` with `restarts=0` within about 30 s, then `healthy` again |

## Grading rubric (100 points)

| Criterion | Points | Full marks when |
| --- | --- | --- |
| Images measured | 15 | `images.csv` has three rows that match the real `measure_image.sh` output within 1%, and the choice in `report.md` names a gain and a cost |
| Image quality | 10 | Evidence 1 and 2 pass, the secret check prints `0`, and `Dockerfile.final` orders its steps so that a one-line edit to `app/` re-runs one step |
| Stack runs | 15 | Evidence 3 and 4 pass, from a clean start, twice |
| Limits and restart | 15 | Evidence 5 and 6 are correct, and the report says how the memory number was chosen |
| Least privilege and networks | 15 | Evidence 7 and 8 are correct |
| Persistence | 10 | Evidence 9 is correct and the report names the volume and the command that destroys it |
| Failure drill and report | 15 | Evidence 10 is correct, and the report corrects the "unhealthy means restarted" claim and names the shared kernel |
| Hygiene | 5 | All listed files are committed, `.env` is not, `.env.example` is, and every command can be re-run |

Below 60 points, return the milestone with the evidence numbers that failed. A student whose machine cannot run all three services at once may halve every limit and says so in the report; grade the evidence, not the numbers.
