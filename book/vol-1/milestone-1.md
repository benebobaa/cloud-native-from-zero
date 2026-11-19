# Milestone 1 · The Wallet on Bare Linux

## What you deliver

You deliver the wallet twice, from the same `wallet.py`: first as a systemd user service that the kernel confines, then as a process inside the container you built in Lab 1.5. You prove every limit by reading it from `/proc` and the cgroup files, and you write down what each way does not protect against. Allow about 3 hours after Lab 1.5.

**Versions tested** (2026-11-17, Ubuntu 26.04 on WSL2, kernel 6.18, cgroup v2, systemd 259, Docker 29.9.2, `python:3.12-alpine` with Python 3.12.16): both units and every evidence command were run, with two differences: the files lived in another directory, and `WALLET_PORT` pointed at a free high port because port 8080 was busy on the shared test machine. The `kill -KILL` restart was run for Part 2 only; Part 1 relies on the same `Restart=` rule that Lab 1.3 tested. Not run: Ubuntu 24.04 itself.

{{diagram milestone-1-01.jsx | Milestone 1 · two ways to run the same wallet}}

Put these files in `~/cn-lab/milestone-1/` and commit them:

| File | What it is |
| --- | --- |
| `wallet.service` | Part 1: the hardened unit |
| `wallet-box.service` | Part 2: the unit that runs the wallet inside your container |
| `mini.sh` | A copy of your script from Lab 1.5 |
| `evidence.txt` | The output of the ten commands in the evidence table below, in order, each under its number |
| `comparison.md` | Part 3: your table and your written comparison |

Do not commit `rootfs/` or `pyroot/`: they are copies of someone else's files.

## Part 1 · The hardened service (60 min)

Start from the unit of Lab 1.3. Replace `~/.config/systemd/user/wallet.service` with this one. Every line under the two comments is a kernel feature from Ch 1.5:

```ini
[Unit]
Description=Wallet v0 (hardened)

[Service]
WorkingDirectory=%h/cn-lab/wallet
ExecStart=/usr/bin/python3 %h/cn-lab/wallet/wallet.py
Restart=on-failure
RestartSec=2

# limits: a cgroup (Ch 1.5)
MemoryMax=128M
TasksMax=32
CPUQuota=50%

# sandbox: what the process may see and do
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallFilter=@system-service
SystemCallArchitectures=native

[Install]
WantedBy=default.target
```

| Directive | What it does | Where in Ch 1.5 |
| --- | --- | --- |
| `MemoryMax`, `TasksMax`, `CPUQuota` | Write `memory.max`, `pids.max`, `cpu.max` of the service's cgroup | Part 4 |
| `NoNewPrivileges` | Sets `no_new_privs`: no setuid program can add power | Part 5 |
| `PrivateTmp`, `PrivateDevices` | A private `/tmp` and a minimal `/dev`, using a mount namespace | Part 1 |
| `ProtectSystem=strict`, `ProtectHome=read-only` | `/` and your home directory become read-only for the service | Part 3 |
| `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectControlGroups` | `/proc/sys`, module loading and `/sys/fs/cgroup` cannot be changed | Parts 1, 4 |
| `RestrictNamespaces` | The service cannot create namespaces itself | Part 1 |
| `RestrictAddressFamilies` | Only IP and local sockets | Part 5 |
| `CapabilityBoundingSet=` (empty) | No capability, ever | Part 2 |
| `SystemCallFilter`, `SystemCallArchitectures` | A seccomp filter that allows only normal service system calls | Part 5 |

Install it and check that the wallet still answers:

```bash
mkdir -p ~/cn-lab/milestone-1 && cd ~/cn-lab/milestone-1
cp ~/.config/systemd/user/wallet.service .
systemctl --user daemon-reload
systemctl --user restart wallet
sleep 2; curl localhost:8080/alice
```

```text
{"account": "alice", "balance": 100}
```

Now read the facts from the kernel, not from your unit file:

```bash
P=$(systemctl --user show -p MainPID --value wallet)
grep -E 'CapEff|CapBnd|NoNewPrivs|Seccomp:' /proc/$P/status
CG=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value wallet)
cat $CG/memory.max $CG/pids.max $CG/cpu.max
systemd-analyze --user security wallet --no-pager | tail -2
```

```text
CapEff:	0000000000000000
CapBnd:	0000000000000000
NoNewPrivs:	1
Seccomp:	2
134217728
32
50000 100000

→ Overall exposure level for wallet.service: 2.5 OK
```

The last command scores the unit's attack surface from 0 (none) to 10. On the test machine the Lab 1.3 unit scored 9.4 UNSAFE and this one 2.5 OK. (The real output has a smiley after `OK`.)

A sandbox you have not attacked is a guess. Run a shell with the same restrictions and try to break out:

```bash
systemd-run --user --wait --pipe --collect -p NoNewPrivileges=yes -p PrivateTmp=yes -p ProtectSystem=strict -p ProtectHome=read-only -p CapabilityBoundingSet= -p RestrictNamespaces=yes -p SystemCallFilter=@system-service sh -c 'touch $HOME/probe; touch /etc/probe; ls /tmp | wc -l; unshare -r true; grep -E "CapBnd|NoNewPrivs|Seccomp:" /proc/self/status'
```

```text
touch: cannot touch '/home/you/probe': Read-only file system
touch: cannot touch '/etc/probe': Read-only file system
0
unshare: unshare failed: Operation not permitted
CapBnd:	0000000000000000
NoNewPrivs:	1
Seccomp:	2
```

Both writes fail, `/tmp` is empty (yours at the host is not), and even creating a user namespace, the first step of this whole chapter, is refused.

## Part 2 · The wallet inside your container (60 min)

You need a root filesystem with Python. Export one from the official image the same way as in Lab 1.5:

```bash
cd ~/cn-lab/container
mkdir pyroot
docker create --name cn-py python:3.12-alpine
docker export cn-py | tar -x -C pyroot
docker rm cn-py
du -sh pyroot
```

```text
54M	pyroot
```

Then write `~/.config/systemd/user/wallet-box.service` and copy it into `~/cn-lab/milestone-1/`. `mini.sh` reads the two `MINI_` variables: `MINI_HOSTNET=1` keeps the host's network, so `curl localhost` works (a network of its own needs the virtual cables of Vol 2), and `MINI_BIND` mounts your wallet directory at `/app` inside:

```ini
[Unit]
Description=Wallet v0 inside the Lab 1.5 container

[Service]
Environment=MINI_HOSTNET=1
Environment=MINI_BIND=%h/cn-lab/wallet:/app
Environment=PATH=%h/cn-lab/pkg/usr/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=%h/cn-lab/container/mini.sh %h/cn-lab/container/pyroot /bin/sh -c 'cd /app && exec python3 wallet.py'
Restart=on-failure
RestartSec=2
MemoryMax=64M
MemorySwapMax=0
TasksMax=32
```

Both units use port 8080, so stop the first before you start the second:

```bash
systemctl --user stop wallet
systemctl --user daemon-reload
systemctl --user start wallet-box
sleep 8; curl localhost:8080/alice
systemctl --user status wallet-box --no-pager | sed -n 1,8p
```

The wallet needs a few seconds to start inside the container; on the test machine it was not answering after 4 seconds. The answer is the same JSON as in Part 1. The status shows the limits that systemd applied: on the test machine `Tasks: 2 (limit: 32)` and `Memory: 28.8M (max: 64M, swap max: 0B ...)`. The journal line `wallet v0 pid=1 port=8080 data=balances.json` says the wallet is PID 1 of its own namespace. Now read the facts from the kernel:

```bash
CG=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value wallet-box)
cat $CG/memory.max $CG/pids.max $CG/memory.swap.max
for p in $(cat $CG/cgroup.procs); do grep -H NSpid /proc/$p/status; done
```

```text
67108864
32
0
/proc/46667/status:NSpid:	46667
/proc/46670/status:NSpid:	46670	1
```

The second line is the wallet: PID 46670 for the host, PID 1 for itself. Compare its user namespace with your shell's, as in Lab 1.5 Part E: `readlink /proc/46670/ns/user /proc/self/ns/user` (use your PID). Finally, crash the container the hard way:

```bash
kill -KILL $(systemctl --user show -p MainPID --value wallet-box)
sleep 6
systemctl --user show -p NRestarts,ActiveState wallet-box
curl localhost:8080/alice
journalctl --user -u wallet-box -n 6 --no-pager
```

On the test machine `NRestarts` was `1`, the wallet answered again, and the journal showed `wallet v0: got SIGTERM, shutting down` before `Scheduled restart job, restart counter is at 1`. The `MainPID` of the unit is the outer `unshare`; killing it left the wallet running as PID 1, so systemd stopped the rest of the cgroup with `SIGTERM`, and the handler you wrote in Lab 1.2 ran inside the container.

## Part 3 · Compare and decide (30 min)

Write `comparison.md`: first the table below with one sentence in each cell, then 150 to 250 words answering the question under it.

| Threat | Run A: hardened service | Run B: your container |
| --- | --- | --- |
| A bug lets an attacker write files in your home directory |  |  |
| A bug lets an attacker call a kernel feature the wallet never needs |  |  |
| The wallet leaks memory without end |  |  |
| The wallet forks without end |  |  |
| A kernel bug lets a process escape |  |  |

Which run would you put in front of strangers' traffic, which settings would you copy from the other, and what do both still trust?

## Evidence: ten commands for `evidence.txt`

Run each command once and paste its output into `evidence.txt` under its number. Commands 1 to 5 are about Run A and 6 to 10 about Run B.

| # | Command | Expected |
| --- | --- | --- |
| 1 | `curl localhost:8080/alice` (Run A) | `{"account": "alice", "balance": 100}` |
| 2 | `grep -E 'CapEff\|CapBnd\|NoNewPrivs\|Seccomp:' /proc/$P/status` | `CapEff` and `CapBnd` all zeros, `NoNewPrivs: 1`, `Seccomp: 2` |
| 3 | `cat $CG/memory.max $CG/pids.max $CG/cpu.max` | `134217728`, `32`, `50000 100000` |
| 4 | `systemd-analyze --user security wallet --no-pager \| tail -2` | an exposure level of 4.0 or less (2.5 on the test machine) |
| 5 | the `systemd-run` attack test of Part 1 | `Read-only file system` twice, `Operation not permitted` for `unshare` |
| 6 | `curl localhost:8080/alice` (Run B) | the same JSON |
| 7 | `cat $CG/memory.max $CG/pids.max $CG/memory.swap.max` | `67108864`, `32`, `0` |
| 8 | the `NSpid` loop over `cgroup.procs` | one process with two numbers, the second `1` |
| 9 | `readlink /proc/<wallet pid>/ns/user /proc/self/ns/user` | two different numbers |
| 10 | `kill -KILL` and `systemctl --user show -p NRestarts wallet-box` | `NRestarts=1`, and `curl` answers again |

## Grading rubric (100 points)

| Criterion | Points | Full marks when |
| --- | --- | --- |
| Run A answers | 10 | Evidence 1 is correct and `wallet.service` uses the directives of Part 1 |
| Limits read from the kernel | 15 | Evidence 3 and 7 have the right numbers, and the notebook says which unit setting wrote which file |
| Sandbox proven by attack | 20 | Evidence 2, 4 and 5 are correct, and the student explains why the writes failed |
| Run B answers | 15 | Evidence 6, 8 and 9 are correct and the unit file uses `mini.sh` as shown |
| Self-healing | 10 | Evidence 10 is correct and the notebook explains the `SIGTERM` line in the journal |
| Comparison | 20 | The table is complete and correct, and the text names the shared kernel and the missing seccomp filter in Run B |
| Hygiene | 10 | All five files are committed, `rootfs/` and `pyroot/` are not, and every command in `evidence.txt` can be re-run |

Below 60 points, return the milestone with the evidence numbers that failed. A student who cannot create user namespaces (Ubuntu 24.04 setting, Lab 1.5 Part 0) may deliver Part 1 only and is graded out of 60.
