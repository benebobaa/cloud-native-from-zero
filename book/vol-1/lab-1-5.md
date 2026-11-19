# Lab 1.5 · A Container From Scratch

## Goal

You will build a container by hand: a process in its own user, PID, mount, UTS, IPC, network and cgroup namespaces, with an Alpine Linux root filesystem as `/`, a memory limit from a cgroup, and fewer powers than root. Then you compare it with `docker run` by reading `/proc`. Nothing here needs `sudo` on most machines.

**Versions tested** (2026-11-17, Ubuntu 26.04 on WSL2, kernel 6.18, cgroup v2): systemd 259, util-linux 2.41.3 (`unshare`, `setpriv`, `pivot_root`), bash 5.3, libcap2-bin 2.75 (`capsh`), Docker 29.9.2 on Docker Desktop, image `alpine:3.21` (Alpine 3.21.10, BusyBox 1.37.0). Every command below was run on that machine without `sudo`, and the outputs are real; your namespace numbers and PIDs will differ. Not run: the Ubuntu 24.04 AppArmor setting in Part 0 (it does not exist on the WSL kernel), and a native Docker Engine (the test machine uses Docker Desktop).

**Before you start.** Docker from Lab 0.1 must work (`docker run --rm alpine:3.21 true`). Open two terminals. All files live in `~/cn-lab/container/`. The lab takes about 3.5 hours.

### What you will build

{{diagram lab-1-5-01.jsx | what you build in Lab 1.5 · 4 layers on one kernel}}

Read it from the bottom: the kernel is shared, and each layer above it is one thing you build, in the order of the parts below.

## Part 0 · Can you create a user namespace? (5 min)

Everything in this lab starts with one command. Run it:

```bash
mkdir -p ~/cn-lab/container ~/cn-lab/pkg ~/cn-lab/dl && cd ~/cn-lab/container
unshare --user --map-root-user id -u
```

It prints `0`: inside the new user namespace you are root. If you see `unshare: write failed /proc/self/uid_map: Operation not permitted` instead, you are on Ubuntu 24.04 with its AppArmor restriction on user namespaces (Ch 1.5, In production). Check it and, on a machine you own, switch it off until the next reboot:

```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

The setting is `1` by default on 24.04; [this write-up](https://dev.to/gabrielanhaia/ubuntu-2404-restricts-user-namespaces-thats-why-your-agents-sandbox-wont-start-5abm) shows the same error. This is the only `sudo` in the lab, and it weakens the whole machine, so use a VM or a lab laptop and set the value back to `1` when you finish. Not tested here: the setting does not exist on the WSL kernel.

## Part A · One namespace at a time (40 min)

You will create each namespace on its own, so you see what each one changes. First, the namespaces your own shell is in:

```bash
ls -l /proc/$$/ns
```

On the test machine (columns before the names removed):

```text
cgroup -> cgroup:[4026532297]
ipc -> ipc:[4026532218]
mnt -> mnt:[4026532298]
net -> net:[4026531833]
pid -> pid:[4026532300]
pid_for_children -> pid:[4026532300]
time -> time:[4026531834]
time_for_children -> time:[4026531834]
user -> user:[4026531837]
uts -> uts:[4026532299]
```

**The user namespace.** Become root without `sudo`, and ask the kernel who you really are:

```bash
unshare --user --map-root-user sh -c 'id -u; grep CapEff /proc/self/status; cat /proc/self/uid_map; touch /etc/x; ls -ln /etc/shadow'
```

```text
0
CapEff:	000001ffffffffff
         0       1000          1
touch: cannot touch '/etc/x': Permission denied
-rw-r----- 1 65534 65534 780 Nov  2 17:30 /etc/shadow
```

You are user `0` with every capability (`CapEff` is 41 one-bits), yet the host refuses to let you write `/etc`. The `uid_map` line says why: user `0` inside is user `1000` (you) outside, for a range of 1 ID. Root's own files have no entry in the map, so they show as the overflow owner `65534`.

**The UTS namespace.** The hostname belongs to a UTS namespace. Try to change it with and without a namespace of your own:

```bash
unshare --user --map-root-user hostname box
unshare --user --map-root-user --uts sh -c 'hostname box; hostname'
hostname
```

```text
hostname: you must be root to change the host name
box
your-laptop
```

The first command made a user namespace but no UTS namespace, so the hostname still belongs to the host, and your capabilities do not reach it. (The message says "must be root" where the kernel really said "not permitted".) The second made both: you own the new UTS namespace, so you may rename it, and the host's name is unchanged.

**The PID namespace.** Start `ps` in a new one:

```bash
unshare -r --pid --fork --mount-proc ps -e -o pid,user,comm
```

```text
    PID USER     COMMAND
      1 root     ps
```

(`-r` is short for `--map-root-user`.) `--fork` makes the command the first process of the namespace, so it is PID 1. `--mount-proc` mounts a fresh `/proc` that shows only this namespace. See what happens without it:

```bash
unshare -r --pid --fork sh -c 'echo "my pid: $$"; ps -e -o pid,comm | wc -l'
```

On the test machine the shell reported `my pid: 1`, yet `ps` listed 138 lines: the old `/proc` still shows every host process.

**The network namespace:**

```bash
unshare -r --net ip addr
```

```text
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
```

One loopback device, switched off: no network, no ports, no routes. This is also why a container needs a virtual cable (Vol 2) to reach anything.

1. Why does `touch /etc/x` fail although `id -u` says 0? Which file shows your real identity?
2. Why is `/etc/shadow` owned by `65534`, and what would a file you own show as inside the namespace?
3. In the PID example without `--mount-proc`, the shell says it is PID 1. Which of the two answers (`$$` or `ps`) comes from the PID namespace, and which from the old `/proc` mount?
4. Of the four namespaces you created, which one needs no `--fork`, and which needs it? Why?

## Part B · A root filesystem and pivot\_root (50 min)

You will unpack an Alpine image into a directory, try `chroot`, see it leak, and then switch to `pivot_root` inside a script you write: `mini.sh`.

**Step 1 · the tool.** `pivot_root` ships in util-linux on Ubuntu 24.04. On newer releases it moved to `util-linux-extra`; `apt-get download` fetches the package without `sudo`, and `dpkg -x` unpacks it into your own directory (as in Lab 1.4):

```bash
command -v pivot_root || (cd ~/cn-lab/dl && apt-get download util-linux-extra && dpkg -x util-linux-extra_*.deb ~/cn-lab/pkg)
export PATH=$HOME/cn-lab/pkg/usr/bin:$PATH
pivot_root --version
```

```text
pivot_root from util-linux 2.41.3
```

**Step 2 · the root filesystem.** Docker can write the files of a container as a tar archive. A stopped container is enough:

```bash
cd ~/cn-lab/container
mkdir rootfs
docker create --name cn-alpine alpine:3.21
docker export cn-alpine | tar -x -C rootfs
docker rm cn-alpine
du -sh rootfs; ls rootfs; cat rootfs/etc/alpine-release
```

```text
8.1M	rootfs
bin  dev  etc  home  lib  media  mnt  opt  proc  root  run  sbin  srv  sys  tmp  usr  var
3.21.10
```

That directory is a whole Linux userland in 8.1 MB. It has no kernel: the container will use yours.

**Step 3 · chroot, and why it is not enough.**

```bash
unshare --user --map-root-user chroot rootfs /bin/sh -c 'cat /etc/alpine-release; grep PRETTY /etc/os-release'
```

```text
3.21.10
PRETTY_NAME="Alpine Linux v3.21"
```

The shell lives in Alpine. Now make the mistake from the theory: call `chroot` but leave the working directory where it was. The `chroot` command always moves to the new `/` afterwards, so use a three-line Python program that does not:

```bash
unshare --user --map-root-user python3 -c '
import os
os.chroot("rootfs")
os.execv("/bin/sh", ["sh", "-c", "grep PRETTY /etc/os-release; grep PRETTY ../../../../../../../../../../../../etc/os-release"])'
```

```text
PRETTY_NAME="Alpine Linux v3.21"
PRETTY_NAME="Ubuntu 26.04.1 LTS"
```

The second line is your host. The shell's working directory is outside the new root, and each `..` walks one step further out; extra `..` stop harmlessly at the real `/`. This is the same mistake as CVE-2024-21626 in Ch 1.5.

**Step 4 · mini.sh.** Type this script. Each line is one idea from the theory, and the comments say which:

```bash
cat > mini.sh <<'EOF'
#!/usr/bin/env bash
# mini.sh ROOTFS CMD... : a container from scratch, no root needed.
# MINI_HOSTNET=1 keeps the host network; MINI_BIND=/host/dir:/dir mounts one directory inside.
set -euo pipefail
root=$(realpath "${1:?usage: mini.sh ROOTFS CMD...}"); shift
flags=(--user --map-root-user --pid --fork --mount --uts --ipc --cgroup)
[[ -n ${MINI_HOSTNET:-} ]] || flags+=(--net)

exec unshare "${flags[@]}" bash -euc '
  root=$1; shift
  hostname mini
  mount --make-rprivate /                # do not leak our mounts to the host
  mount --bind "$root" "$root"           # pivot_root needs a mount point
  for d in null zero urandom tty; do touch "$root/dev/$d"; mount --bind "/dev/$d" "$root/dev/$d"; done
  if [[ -n ${MINI_BIND:-} ]]; then mkdir -p "$root${MINI_BIND#*:}"; mount --bind "${MINI_BIND%%:*}" "$root${MINI_BIND#*:}"; fi
  mount -t proc proc "$root/proc"        # a view of this PID namespace
  mkdir -p "$root/sys/fs/cgroup"; mount -t cgroup2 none "$root/sys/fs/cgroup"   # the cgroup of this container
  cd "$root"; mkdir -p oldroot
  pivot_root . oldroot                   # the new root becomes /
  hash -r                                # the host binaries are gone; forget their paths
  umount -l /oldroot; rmdir /oldroot     # forget the old root too
  exec "$@"
' _ "$root" "$@"
EOF
chmod +x mini.sh
```

The outer `unshare` creates the namespaces and a PID 1 (`--fork`). The inner `bash` runs inside them: it renames the host, prepares the mounts in the new mount namespace, swaps the root, and finally replaces itself with your command (`exec`), which becomes PID 1 of the container.

**Step 5 · run it.**

```bash
./mini.sh rootfs /bin/sh
```

You are now in Alpine's shell. Type these inside it:

```bash
hostname
cat /etc/alpine-release
id -u
ps
ip addr
ls /oldroot
cat /proc/self/cgroup
```

```text
mini
3.21.10
0
PID   USER     TIME  COMMAND
    1 root      0:00 /bin/sh
   23 root      0:00 ps
1: lo: <LOOPBACK> mtu 65536 qdisc noop state DOWN qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
ls: /oldroot: No such file or directory
0::/
```

The hostname, the files, the process list, the network and the root all differ from the host. (`ps` shows PID 23 for itself because `mini.sh` ran a few helper commands first; yours may differ.) Type `exit` to leave.

1. `ps` shows two processes. Which program is PID 1, and why is it not the bash of mini.sh that started it (`exec`)?
2. Delete the `mount --bind "$root" "$root"` line, run `./mini.sh rootfs /bin/sh` again and read the error. Which sentence of [pivot\_root(2)](https://man7.org/linux/man-pages/man2/pivot_root.2.html) explains it? Restore the line afterwards.
3. Why is `/oldroot` gone, although `pivot_root` put the old root there? Which flag of `umount` did the work?
4. `cat /proc/self/cgroup` prints `0::/`. What does that say about the cgroup namespace?

## Part C · cgroups: limits you can read (50 min)

You will limit your container's memory with a cgroup, watch the kernel enforce it, and measure what happens. `systemd-run --user --scope` asks your own systemd to create the cgroup, then runs your command inside it (Ch 1.5, part 4).

**Step 1 · a memory hog.** It must live inside the container's root filesystem:

```bash
cd ~/cn-lab/container
cat > rootfs/hog.sh <<'EOF'
#!/bin/sh
# hog.sh: feed 1 MB of zero bytes every 0.1 s into tail, which keeps all of it
# (tail waits for the last 10 lines, and zero bytes contain no newline)
while :; do head -c 1048576 /dev/zero; sleep 0.1; done | tail
EOF
chmod +x rootfs/hog.sh
```

**Step 2 · a container with a limit (terminal 1).**

```bash
cd ~/cn-lab/container
systemd-run --user --scope --unit=box1 -p MemoryMax=64M -p MemorySwapMax=0 -p OOMPolicy=continue ./mini.sh rootfs /bin/sh
```

The three properties write `memory.max`, `memory.swap.max` and the OOM policy. Without `OOMPolicy=continue`, systemd stops the whole scope when the kernel kills one process in it, and you could not look around afterwards. Inside the new shell:

```bash
cat /sys/fs/cgroup/memory.max
```

```text
67108864
```

That is 64 × 1024 × 1024. Your container sees its own cgroup as the top of the tree (the cgroup namespace), so it reads its limit from the same path a Pod does.

**Step 3 · a sampler (terminal 2).** This script reads the container's `memory.current` and `oom_kill` counter ten times a second, from outside, until the cgroup disappears:

```bash
cd ~/cn-lab/container
cat > sample.sh <<'EOF'
#!/usr/bin/env bash
# sample.sh UNIT: every 0.1 s print "ms,memory.current,oom_kill" until the scope disappears
cg=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value "$1")
t0=$(date +%s%N)
while [[ -r $cg/memory.current ]]; do
  echo "$(( ($(date +%s%N) - t0) / 1000000 )),$(< $cg/memory.current),$(awk '$1=="oom_kill"{print $2}' $cg/memory.events 2>/dev/null)"
  sleep 0.1
done
EOF
chmod +x sample.sh
./sample.sh box1.scope > mem.csv
```

**Step 4 · feed the hog (terminal 1).** Start the hog in the background of the container's shell, wait 15 seconds, read the counters, and leave:

```bash
/hog.sh >/dev/null 2>&1 &
sleep 15; cat /sys/fs/cgroup/memory.events
exit
```

```text
low 0
high 0
max 484
oom 26
oom_kill 1
oom_group_kill 0
```

Leaving the shell ends the scope, and `sample.sh` stops by itself. If the last row of `mem.csv` has an empty third column, delete that row. The journal also saw the kill: `journalctl --user -u box1.scope -n 3 --no-pager` ends with `box1.scope: The kernel OOM killer killed some processes in this unit.` The chart below plots the test machine's `mem.csv`; yours should have the same shape.

{{diagram lab-1-5-02.jsx | measured on the test machine, 2026-11-17 · sample.sh of Part C step 3, 88 samples until the scope ended}}

The row at 11.8 s is the proof: `memory.current` equals `memory.max` (67108864) and `oom_kill` is 1. The next sample, 0.3 s later, is 2 MiB. The kernel did not slow the hog down or refuse its memory politely; it killed `tail`, the largest process in the cgroup, and the cgroup got its pages back. `max 484` counts how often the limit was hit while the kernel still tried to free memory first.

**Step 5 · why `MemorySwapMax=0`.** Run the same hog without it, with a new unit name:

```bash
systemd-run --user --scope --unit=box2 -p MemoryMax=64M ./mini.sh rootfs /bin/sh -c '/hog.sh >/dev/null 2>&1 & sleep 14; cat /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.swap.current'
```

```text
low 0
high 0
max 122
oom 0
oom_kill 0
oom_group_kill 0
19480576
```

After 14 seconds nothing had been killed. The limit was hit 122 times, but the kernel moved the hog's pages to swap instead (19480576 bytes, about 18.6 MiB, in `memory.swap.current`; the test machine has 2 GiB of swap). A memory limit alone is not a hard stop on a machine with swap.

**Step 6 · a CPU limit.** CPU cannot be "killed", so the kernel throttles. Run a busy loop for 6 seconds with a quota of 20 percent of one CPU, and read its cgroup after 4.5 seconds:

```bash
systemd-run --user --scope --unit=cpu1 -p CPUQuota=20% timeout 6 sh -c 'while :; do :; done' &
sleep 4.5
CG=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value cpu1.scope)
cat $CG/cpu.max $CG/cpu.stat
```

```text
20000 100000
usage_usec 938819
user_usec 874723
system_usec 64096
nice_usec 0
nr_periods 46
nr_throttled 46
throttled_usec 3481494
nr_bursts 0
burst_usec 0
```

`20000 100000` means 20 000 microseconds of CPU per 100 000-microsecond period. In 4.5 seconds the loop used 0.94 seconds of CPU (about 21 percent of one core) and was throttled in 46 of 46 periods, waiting 3.5 seconds in total.

**Step 7 · a process limit.** `TasksMax` writes `pids.max`. Start ten sleeps in a scope that allows eight tasks:

```bash
systemd-run --user --scope -p TasksMax=8 bash -c 'for i in $(seq 10); do sleep 2 & done; wait; echo finished'
```

On the test machine bash printed `/usr/bin/bash: fork: retry: Resource temporarily unavailable` four times before it could start the last sleeps, then `finished`: `fork` fails once the cgroup is full, and bash retries.

1. In the chart, which sample proves the limit was reached and the kill happened? What does `memory.current` do right after it, and why?
2. `memory.events` says `max 484` but `oom_kill 1`. What does each counter count?
3. Repeat Steps 2 to 4 with a new unit name and without `-p OOMPolicy=continue`. What does your container shell print when the hog dies? Find the matching line in `journalctl --user -u <unit>`. Which process did the kernel kill, and which did systemd?
4. Which difference between Step 4 and Step 5 turned a kill into a quiet slowdown? Use the name of the cgroup file that `MemorySwapMax` writes.
5. In Step 6 the loop wants 100 percent of a CPU and gets 20. A web service under such a limit would show low average CPU and high latency. Which two numbers in `cpu.stat` prove it was throttled?

## Part D · Capabilities: what root is allowed to do (25 min)

A capability mask is a hexadecimal number, and `capsh` translates it. Decode the mask your container has, and the one Docker gives its containers (you will read that one yourself in Part E):

```bash
capsh --decode=000001ffffffffff | cut -c1-110
capsh --decode=00000000a80425fb
```

```text
0x000001ffffffffff=cap_chown,cap_dac_override,cap_dac_read_search,cap_fowner,cap_fsetid,cap_kill,cap_setgid,...
0x00000000a80425fb=cap_chown,cap_dac_override,cap_fowner,cap_fsetid,cap_kill,cap_setgid,cap_setuid,cap_setpcap,cap_net_bind_service,cap_net_raw,cap_sys_chroot,cap_mknod,cap_audit_write,cap_setfcap
```

The first mask is all 41 capabilities the test kernel knows. The second has 14. Now drop one capability for good and see what stops working. `setpriv --bounding-set -name` removes `name` from the bounding set, the capabilities a process can never get back:

```bash
unshare --user --map-root-user --uts setpriv --bounding-set -sys_admin hostname box
unshare --user --map-root-user --uts setpriv --bounding-set -kill sh -c 'hostname box && hostname; grep CapBnd /proc/self/status'
```

```text
hostname: you must be root to change the host name
box
CapBnd:	000001ffffffffdf
```

The first command lost `CAP_SYS_ADMIN`, and renaming the host needs it. The second lost `CAP_KILL`, which renaming does not need, so it works; the mask differs from all-ones by one bit (`df` instead of `ff`). Finally, read the powers of your container and its other kernel protections:

```bash
./mini.sh rootfs /bin/sh -c "grep -E 'CapEff|NoNewPrivs|Seccomp:' /proc/self/status"
```

```text
CapEff:	000001ffffffffff
NoNewPrivs:	0
Seccomp:	0
```

All 41 capabilities, but only over the namespaces your user namespace owns; no `no_new_privs`; and no seccomp filter (`0`). Your container is well separated and badly restricted. Part E shows what Docker adds.

1. `hostname box` failed without `CAP_SYS_ADMIN` and worked without `CAP_KILL`. What does that say about how a capability relates to a system call?
2. Your mask has 41 bits set and Docker's has 14. Which of Docker's 14 would you remove first for a service that only listens on port 8080 and talks to a database, and why?
3. Your container's `CapEff` is full but it cannot change the host's clock. Which namespace limits those capabilities (Ch 1.5, part 2)?

## Part E · Compare with docker run (30 min)

You will read the same kernel facts from a Docker container and from yours, and put them side by side.

**Step 1 · Docker's container, from inside.** The same limit, and the same files you read before:

```bash
docker run --rm -m 64m alpine:3.21 sh -c 'cat /sys/fs/cgroup/memory.max; grep -E "CapEff|NoNewPrivs|Seccomp:" /proc/self/status; for n in cgroup ipc mnt net pid user uts; do printf "%s " $n; readlink /proc/self/ns/$n; done'
```

```text
67108864
CapEff:	00000000a80425fb
NoNewPrivs:	0
Seccomp:	2
cgroup cgroup:[4026533980]
ipc ipc:[4026533978]
mnt mnt:[4026533976]
net net:[4026533981]
pid pid:[4026533979]
user user:[4026531837]
uts uts:[4026533977]
```

Compare the `user` line with the one you printed in Part A: on the test machine it is the same number, `4026531837`. Docker did not create a user namespace, so the root of this container is the real root of the machine it runs on.

**Step 2 · your container, from outside.** In terminal 1 start a container that just sleeps, inside a limited scope:

```bash
systemd-run --user --scope --unit=box5 -p MemoryMax=64M ./mini.sh rootfs /bin/sleep 120
```

In terminal 2, list the processes of its cgroup and their PIDs in every PID namespace:

```bash
CG=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value box5.scope)
for p in $(cat $CG/cgroup.procs); do grep -H NSpid /proc/$p/status; done
```

```text
/proc/28746/status:NSpid:	28746
/proc/28749/status:NSpid:	28749	1
```

The first process is the outer `unshare`, still in your PID namespace (one number). The second is your container's PID 1: PID 28749 for the host, PID 1 for itself. Use your own number for `P` below:

```bash
P=28749
for n in cgroup ipc mnt net pid user uts; do printf "%-6s yours %-22s container %s\n" $n "$(readlink /proc/self/ns/$n)" "$(readlink /proc/$P/ns/$n)"; done
grep -E 'CapEff|NoNewPrivs|Seccomp:' /proc/$P/status
cat /proc/$P/cgroup
```

```text
cgroup yours cgroup:[4026532297]    container cgroup:[4026533000]
ipc    yours ipc:[4026532218]       container ipc:[4026532998]
mnt    yours mnt:[4026532298]       container mnt:[4026532996]
net    yours net:[4026531833]       container net:[4026533001]
pid    yours pid:[4026532300]       container pid:[4026532999]
user   yours user:[4026531837]      container user:[4026532995]
uts    yours uts:[4026532299]       container uts:[4026532997]
CapEff:	000001ffffffffff
NoNewPrivs:	0
Seccomp:	0
0::/user.slice/user-1000.slice/user@1000.service/app.slice/box5.scope
```

Every namespace differs from yours, including the user namespace, and the container's cgroup is the `box5.scope` you created. Pressing `Ctrl+C` is not enough: a PID 1 without a signal handler ignores it (Break it, question 4). Stop the container with \`systemctl --user kill --signal=KILL box5.scope\`, or wait for the 120 seconds to pass.

**Step 3 · the host's view of Docker's container.** On a native Docker Engine you can do the same from outside with `sudo readlink /proc/$(docker inspect -f '{{.State.Pid}}' <name>)/ns/user` (not run here). Docker Desktop on WSL2 runs the daemon in a different PID namespace, so on the test machine the container's host PID is not visible in your `/proc`; that is why Step 1 reads the numbers from inside.

**Step 4 · the table.** Put your two outputs into one table with the rows *user namespace*, *CapEff*, *Seccomp*, *NoNewPrivs*, *memory.max* and *root filesystem*, and one column each for `mini.sh` and `docker run -m 64m`. The table in Ch 1.5, part 6, holds the test machine's values; yours should match it except for the namespace numbers.

1. Which namespaces does the Docker container share with your shell, and which does yours share? What would `MINI_HOSTNET=1` change?
2. The Docker container has fewer capabilities and a seccomp filter, yet the theory calls your container's root safer on the host. Which single row of your table explains this?
3. Docker's container shares your shell's user namespace. Who is root inside it, as seen by the host, and what does that mean after a container escape?

## Checkpoint

You are done when these hold. Commit `mini.sh`, `sample.sh` and `mem.csv` with your notes in `~/cn-lab/lab-1.5.md`. Do not commit `rootfs/`: it is 8 MB of someone else's files.

| Check | Expected |
| --- | --- |
| `unshare --user --map-root-user id -u` | `0` |
| `./mini.sh rootfs /bin/cat /etc/alpine-release` | `3.21.10` |
| `./mini.sh rootfs /bin/sh -c 'ls /oldroot'` | `ls: /oldroot: No such file or directory` |
| `systemd-run --user --scope -p MemoryMax=64M ./mini.sh rootfs /bin/cat /sys/fs/cgroup/memory.max` | `67108864` |
| `sort -t, -k2 -n mem.csv \| tail -1` | a row whose second column is `67108864` and whose third is `1` |
| `unshare -r --uts setpriv --bounding-set -sys_admin hostname box` | `hostname: you must be root to change the host name` |
| `docker run --rm alpine:3.21 sh -c 'grep Seccomp: /proc/self/status'` | `Seccomp:` and `2`; yours printed `0` |
| Notebook | Answers to the numbered questions of Parts A to E, and your Step 4 table |

## Break it: the death of PID 1

The first process of a PID namespace is special. Kill it by accident, on purpose:

```bash
unshare --user --map-root-user --pid bash
```

There is no `--fork` and no `--mount-proc` here: that is the mistake. In the new shell, type:

```bash
echo "my PID: $$"
sleep 1
sleep 1
echo still here
ls
exit
```

On the test machine the first `sleep` ran, and the second printed `bash: fork: Cannot allocate memory`. `echo` (built into bash) still worked, but `ls` failed the same way, and so would every command that needs a new process. `exit` leaves.

1. Which process was PID 1 of the new namespace? Why did its exit break everything after it? Read the section "The namespace init process" of [pid\_namespaces(7)](https://man7.org/linux/man-pages/man7/pid_namespaces.7.html).
2. Why does `--fork` (Part A) avoid this?
3. The message says "memory", yet memory is fine. Which production symptom in the table of Ch 1.5 has the same words, and what are its two possible causes?
4. The wallet will run as PID 1 of its container in the Milestone. Why is its `SIGTERM` handler from Lab 1.2 more important there than on your laptop? On the test machine, stopping a scope whose PID 1 was a plain sleep took 1 minute 30 seconds, and Ctrl+C did nothing. Check the same man page for what PID 1 does with signals it has no handler for.
5. Clean up: `systemctl --user reset-failed` clears the records of scopes that ended badly, and `systemctl --user list-units --all 'box*' 'cpu*'` should show none left.
