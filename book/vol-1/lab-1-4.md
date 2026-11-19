# Lab 1.4 · The Operator's Toolkit

## Goal

You will write a script that fails safely, run your own SSH server and log in with a key, then diagnose four machine faults that you inject yourself, and turn what you learned into a health-check script that exits non-zero when something is wrong.

**Versions tested** (2026-11-16, Ubuntu 26.04 on WSL2, kernel 6.18): bash 5.3.9, OpenSSH 10.2p1, sysstat 12.7.7, procps-ng 4.0.4, iproute2 6.19, ShellCheck 0.11.0, lsof 4.99.4, Python 3.14, systemd 259. Every output below came from those runs. The test machine was shared with other builds, so its baseline is busier than an idle laptop: your idle numbers will be smaller, the shapes the same. Not run: `apt install` and `sudo` steps (the lab avoids them), and `sar` (it needs a data collector that was not set up).

**Before you start:** the wallet from Lab 1.2 in `~/cn-lab/wallet/` (with its `SIGTERM` handler) and the tools from the theory section. If you have `sudo`, `sudo apt install -y sysstat shellcheck` is the quick way; Part B shows how to get `sysstat` without it. Keep two terminals open.

### What you will build

{{diagram lab-1-4-01.jsx | what you will see in Lab 1.4 · one row per part}}

## Part A · Scripts that fail safely (30 min)

You will run a backup script with three hidden bugs, then add one line and watch each bug stop the script.

```bash
mkdir -p ~/cn-lab/safe/backups && cd ~/cn-lab/safe
cat > fragile.sh <<'EOF'
#!/usr/bin/env bash
# fragile.sh : a backup script with three bugs
cd /nonexistent/backups
echo "cleaning $PWD"
rm -f "$BACKUP_DIR"/*.old
curl -s http://localhost:1/data | wc -l
echo "backup finished"
EOF
chmod +x fragile.sh
./fragile.sh; echo "exit=$?"
```

On the test machine:

```text
./fragile.sh: line 3: cd: /nonexistent/backups: No such file or directory
cleaning /home/student/cn-lab/safe
0
backup finished
exit=0
```

Now replace line 2 (the comment) with the safety line, and run again:

```bash
sed -i '2s/.*/set -euo pipefail/' fragile.sh
./fragile.sh; echo "exit=$?"
```

```text
./fragile.sh: line 3: cd: /nonexistent/backups: No such file or directory
exit=1
```

Fix the `cd` line, then let each remaining bug show itself:

```bash
sed -i 's|^cd .*|cd "$HOME/cn-lab/safe/backups"|' fragile.sh
./fragile.sh; echo "exit=$?"                         # second bug
BACKUP_DIR=$PWD/backups ./fragile.sh; echo "exit=$?"  # third bug
```

```text
cleaning /home/student/cn-lab/safe/backups
./fragile.sh: line 5: BACKUP_DIR: unbound variable
exit=1
cleaning /home/student/cn-lab/safe/backups
0
exit=7
```

The last run printed `0` from `wc -l`, yet the script stopped with `7`, the exit status of `curl` (could not connect). Without `pipefail` that failure was invisible. Finally ask ShellCheck about the original:

```bash
shellcheck fragile.sh
```

It reports `SC2164` on the `cd` line when `cd` has no check. Write the finished script as `good.sh`, with cleanup and your own error message, and run it with and without `BACKUP_DIR`:

```bash
cat > good.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd "$HOME/cn-lab/safe/backups"
echo "cleaning $PWD"
rm -f "${BACKUP_DIR:?set BACKUP_DIR}"/*.old
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -s http://localhost:8080/alice > "$tmp/alice.json" || { echo "wallet not answering" >&2; exit 1; }
mv "$tmp/alice.json" alice.json
echo "backup finished"
EOF
chmod +x good.sh
shellcheck good.sh && BACKUP_DIR=$PWD/backups ./good.sh; echo "exit=$?"
./good.sh; echo "exit=$?"
```

With the wallet stopped, the first run prints `wallet not answering` and `exit=1`; the second prints `BACKUP_DIR: set BACKUP_DIR` and `exit=1`. Start the wallet (`cd ~/cn-lab/wallet && ./wallet.py &`) and the first run ends with `backup finished` and `exit=0`.

1. Which of the three settings caught each bug? Which bug would `set -e` alone have missed?
2. `curl ... || { ...; exit 1; }` already handles the failure. Why keep `pipefail` anyway?
3. *Predict, then test:* the script is killed with `kill -TERM` while it waits for a long `sleep`. Is the temporary directory removed? What if you use `kill -KILL`? Add `sleep 30 & wait $!` after the `trap` line to find out.

## Part B · Packages and SSH without root (45 min)

You will look inside the package system, fetch tools without installing them, then create keys and talk to your own SSH server.

**Packages.**

```bash
apt-cache policy sysstat
mkdir -p ~/cn-lab/pkg ~/cn-lab/dl && cd ~/cn-lab/dl
apt-get download sysstat openssh-server openssh-sftp-server libwrap0
dpkg -c sysstat_*.deb | head -4
for d in *.deb; do dpkg -x "$d" ~/cn-lab/pkg; done
~/cn-lab/pkg/usr/bin/iostat -V | head -1
dpkg -S "$(command -v ss)"
```

```text
sysstat:
  Installed: (none)
  Candidate: 12.7.7-0ubuntu2
  Version table:
     12.7.7-0ubuntu2 500
        500 http://id.archive.ubuntu.com/ubuntu resolute/main amd64 Packages
...
sysstat version 12.7.7
iproute2: /usr/bin/ss
```

`apt-cache policy` shows a candidate version and the repository it comes from; `apt-get download` fetched four `.deb` files into the current directory with no root; `dpkg -x` unpacked them into `~/cn-lab/pkg`, where `iostat` now runs. From here on, add `~/cn-lab/pkg/usr/bin` to your `PATH` if you did not install `sysstat` with `sudo`: `export PATH=$HOME/cn-lab/pkg/usr/bin:$PATH`.

**Keys and a server.** A real server would already be running `sshd`. You will run one of your own on port 2222, as yourself, that accepts only your key:

```bash
mkdir -p ~/cn-lab/ssh && cd ~/cn-lab/ssh
ssh-keygen -t ed25519 -N '' -C "cn-lab client" -f client_key    # no passphrase: for this lab only
ssh-keygen -t ed25519 -N '' -C "cn-lab host"   -f host_key      # the server's identity
cp client_key.pub authorized_keys
chmod 600 client_key host_key authorized_keys
ssh-keygen -lf client_key.pub
```

```text
256 SHA256:FG4xx2X3A5M8...  cn-lab client (ED25519)
```

The long line after `SHA256:` is the key's *fingerprint*, a short name you can compare by eye. Now write the server's configuration and the client's:

```bash
cat > sshd_config <<EOF
Port 2222
ListenAddress 127.0.0.1
HostKey $HOME/cn-lab/ssh/host_key
AuthorizedKeysFile $HOME/cn-lab/ssh/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PidFile $HOME/cn-lab/ssh/sshd.pid
SshdSessionPath $HOME/cn-lab/pkg/usr/lib/openssh/sshd-session
SshdAuthPath $HOME/cn-lab/pkg/usr/lib/openssh/sshd-auth
Subsystem sftp $HOME/cn-lab/pkg/usr/lib/openssh/sftp-server
EOF
cat > config <<EOF
Host lab
  HostName localhost
  Port 2222
  IdentityFile ~/cn-lab/ssh/client_key
  IdentitiesOnly yes
  UserKnownHostsFile ~/cn-lab/ssh/known_hosts
  StrictHostKeyChecking accept-new
EOF
```

The two `Ssh...Path` lines exist because OpenSSH 10.2 splits the server into several programs that normally sit in `/usr/lib/openssh`; if `sshd -t` rejects them as unknown options on an older release, delete them. In **terminal 1** start the server in the foreground (`-D`) with its log on the screen (`-e`):

```bash
LD_LIBRARY_PATH=$HOME/cn-lab/pkg/usr/lib/x86_64-linux-gnu ~/cn-lab/pkg/usr/sbin/sshd -D -e -f ~/cn-lab/ssh/sshd_config
```

In **terminal 2**, log in with the key, twice:

```bash
cd ~/cn-lab/ssh
ssh -F config lab 'echo hello from $(hostname) as $(whoami)'
ssh -F config lab 'echo second login: no prompt'
cut -c1-60 known_hosts
```

```text
Warning: Permanently added '[localhost]:2222' (ED25519) to the list of known hosts.
hello from lab-laptop as student
second login: no prompt
[localhost]:2222 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF4OQG/30OCqDPf
```

The first connection recorded the server's host key (`accept-new` trusts a *new* host once and still refuses a *changed* one); the second connection checked it silently. Terminal 1 shows `Accepted publickey for ... ED25519 SHA256:...`. Now break things on purpose, one at a time:

```bash
ssh-keygen -t ed25519 -N '' -f other -q
ssh -F /dev/null -i other -o IdentitiesOnly=yes -o BatchMode=yes -p 2222 -o UserKnownHostsFile=$HOME/cn-lab/ssh/known_hosts localhost true; echo "exit=$?"
chmod 644 client_key; ssh -F config -o BatchMode=yes lab true; chmod 600 client_key
```

The first prints `Permission denied (publickey).` and `exit=255`: the server does not know the key `other`. The second prints `WARNING: UNPROTECTED PRIVATE KEY FILE!` and `Permissions 0644 ... are too open`, and the client ignores the key. Then forward a port. Start the wallet in a third terminal (`cd ~/cn-lab/wallet && ./wallet.py`), and:

```bash
ssh -F config -f -N -L 9091:localhost:8080 lab
curl -s localhost:9091/alice
ss -ltnp 'sport = :9091'
```

```text
{"account": "alice", "balance": 100}
LISTEN 0      128        127.0.0.1:9091      0.0.0.0:*    users:(("ssh",pid=179420,fd=5))
```

Stop that background `ssh` with `kill 179420` (use the PID `ss` showed you). Finally, give the server a new identity, as if the machine had been rebuilt: stop `sshd` in terminal 1 with `Ctrl+C`, create a new host key and start it again:

```bash
ssh-keygen -t ed25519 -N '' -C "rebuilt host" -f host_key2 -q
sed -i 's|host_key$|host_key2|' sshd_config
# restart sshd in terminal 1 (same command as before), then in terminal 2:
ssh -F config -o BatchMode=yes lab true; echo "exit=$?"
```

The client prints `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!`, names the line of `known_hosts` that disagrees, and ends with `Host key verification failed.` and `exit=255`. It even prints the exact `ssh-keygen -f ... -R '[localhost]:2222'` command to remove the old record. Run it, connect again, and the new key is recorded.

1. In `authorized_keys` which file did you copy: the private or the public key? What could a stranger do with each?
2. Why does the first login print a `Warning: Permanently added` line and the second not?
3. The `REMOTE HOST IDENTIFICATION HAS CHANGED` warning has two possible meanings. How would you tell them apart in real life before running `ssh-keygen -R`?
4. A colleague proposes `StrictHostKeyChecking no` to "stop the warnings" in CI. Which attack does that re-open?

## Part C · The first 60 seconds on a healthy machine (20 min)

You will run the ten-command routine once while nothing is wrong, so that you know what normal looks like. Start the wallet (`cd ~/cn-lab/wallet && ./wallet.py &`), then in a second terminal:

```bash
uptime
journalctl -k -n 5 --no-pager        # or: dmesg | tail
vmstat 1 3
mpstat -P ALL 1 1 | sed -n 3,5p
pidstat 1 1 | head -6
iostat -xz 1 2
free -m
ip -s link show eth0                 # your interface name may differ: ip -br link
ss -s
top -b -n1 | head -12
```

On the test machine (outputs trimmed, `iostat` shows only the root disk, columns cut):

```text
 14:50:00 up  2:50,  2 users,  load average: 9.21, 17.13, 15.27

procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu
10  0 1076444  79536 159692 4313032  126  311  3276  3291 5567    7  6  4 89  0  0  0
 2  0 1076428  91580 159692 4313532   16    0   376    64 14259 21558 11  9 79  1  0  0
 0  0 1076428  94780 159692 4313664    0    0     0    24 18062 28419  5  7 87  0  0  0

14:50:03     CPU    %usr   %nice    %sys %iowait    %irq   %soft  %steal  %guest  %gnice   %idle
14:50:03     all    5.41    0.00    2.95    0.49    0.00    2.54    0.00    0.00    0.00   88.60

               total        used        free      shared  buff/cache   available
Mem:            7804        4257         103         734        4369        3546
Swap:           2048        1051         996
```

Read three things before you go on. (1) The **first line of `vmstat`** says `id 89` and `r 10`: it is the average since boot, not the present. The next lines are the present, and they show `id 79` and `id 87`. (2) `free` is only 103 MB but `available` is 3546 MB: the page cache holds the rest, as Ch 1.2 explained. (3) Load average `9.21` on 12 cores looks alarming, yet the 1-minute figure lags behind what the CPU does now; the test machine was running other builds.

1. Write your machine's *normal* in one line per resource: busy percent, runnable tasks against cores, `available` memory, disk `%util`. You will compare against it for the rest of the lab.
2. Which of the ten commands would you drop if you had only 20 seconds? Defend the choice with the letters of USE.

## Part D · Four incidents (60 min)

You will inject four faults, one at a time, and diagnose each with the USE method before you look at how it was made. Type this script into `~/cn-lab/slow/fault.sh`, make it executable, and *do not study the code for the fault you are about to diagnose*. Every fault stops by itself, and none is dangerous: the CPU fault runs at low priority (`nice -n 10`), the memory fault is confined to a 200 MB cgroup, the disk fault writes one temporary file in your lab folder, and the network fault uses port 9000 on the loopback address.

```bash
mkdir -p ~/cn-lab/slow && cd ~/cn-lab/slow
cat > fault.sh <<'EOF'
#!/usr/bin/env bash
# Inject one fault for a few seconds. Usage: ./fault.sh cpu|mem|disk|net [seconds]
set -euo pipefail
kind=${1:?usage: fault.sh cpu|mem|disk|net [seconds]}
secs=${2:-20}

case $kind in
  cpu)   # twice as many busy loops as cores
    for _ in $(seq $(( $(nproc) * 2 ))); do
      timeout "$secs" nice -n 10 python3 -c 'while True: pass' &
    done
    wait || true ;;
  mem)   # a 300 MB working set inside a 200 MB cgroup
    timeout "$secs" systemd-run --user --scope -q --unit=slow-mem -p MemoryMax=200M python3 -c '
b = bytearray(300 * 2**20)
while True:
    for i in range(0, len(b), 4096): b[i] = 1' || true ;;
  disk)  # many small writes, each waiting for the disk
    timeout "$secs" dd if=/dev/zero of="$HOME/cn-lab/slow/junk" bs=4k count=100000 oflag=dsync status=none || true
    rm -f "$HOME/cn-lab/slow/junk" ;;
  net)   # a server that never accepts, and clients that keep knocking
    python3 - "$secs" <<'PY'
import socket, sys, time
srv = socket.socket(); srv.bind(("127.0.0.1", 9000)); srv.listen(1)   # backlog 1, no accept()
end, clients = time.time() + int(sys.argv[1]), []
while time.time() < end:
    for _ in range(20):
        c = socket.socket(); c.setblocking(False)
        try: c.connect(("127.0.0.1", 9000))
        except BlockingIOError: pass
        clients.append(c)
    time.sleep(1)
PY
    ;;
  *) echo "unknown fault: $kind" >&2; exit 2 ;;
esac
EOF
chmod +x fault.sh && shellcheck fault.sh
```

For each incident: start the fault in **terminal 1**, and in **terminal 2** go through the USE loop (errors, saturation, utilization) for CPU, memory, disk and network. Write down the resource, the letter that gave it away, and the process. The outputs below are what the test machine showed.

### Incident 1 (`./fault.sh cpu 25`)

```bash
uptime; vmstat 1 4
top -b -n1 -o %CPU | head -14
```

```text
 14:42:16 up  2:42,  2 users,  load average: 24.43, 18.17, 12.26
procs -----------memory---------- ---swap-- -----io---- -system-- -------cpu-------
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu
36  0 932540  76756 177412 4049640   69  208  3082  3086 4981    6  5  3 91  0  0  0
35  0 932624  84656 177500 4045056   24  112  8628  1608 16474 36601 78 20  2  0  0  0
45  1 932624  83588 177252 3993024    4    0  5976  2956 14622 32221 77 22  1  0  0  0
35  1 932764  78500 177420 3988692    0  140  1416  1232 14389 31818 76 24  0  0  0  0

%Cpu(s): 11.4 us, 11.4 sy, 73.1 ni,  1.0 id,  0.0 wa,  0.0 hi,  3.1 si,  0.0 st
    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
  99164 student   30  10   16060   9712   6620 R 100.0   0.1   0:03.43 python3
  99170 student   30  10   16060   9724   6628 R 100.0   0.1   0:02.75 python3
```

The run queue `r` is 35 to 45 on 12 cores (saturation), and `id` is 1 to 2 percent (utilization is total). `top` names the culprits: many `python3` processes with `NI 10`, and `73.1 ni` in the CPU line says that almost all the CPU time went to niced work.

1. Which letter of USE gave it away first, and what would `uptime` alone have told you?
2. The first `vmstat` line says `id 91`. Why must you ignore it?
3. The faults run at `nice 10`. What does that tell you about whether the wallet would still have answered during this incident, and why might that make it a *worse* incident to notice?

### Incident 2 (`./fault.sh mem 25`)

```bash
vmstat 1 4
free -m
CG=/sys/fs/cgroup$(systemctl --user show -p ControlGroup --value slow-mem.scope)
cat $CG/memory.max $CG/memory.current $CG/memory.swap.current $CG/memory.events
```

```text
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st gu
 4  1 1677076  96284 109640 4642456  192  471  4815  4396 7055   10  8  6 85  0  0  0
 8  0 1678172  79148 109720 4667708 17688 18460 42664 19392 35282 63134 25 29 41  5  0  0
 6  4 1673124  89148 109552 4694440 22172 15868 80708 16344 54149 88201 26 26 43  5  0  0
 6  1 1671784  77004 109316 4708368 18136 17288 79624 460408 54375 90314 24 30 41  4  0  0
               total        used        free      shared  buff/cache   available
Mem:            7804        3904          69         688        4711        3900
Swap:           2048        1632         415
209715200
209526784
109576192
low 0
high 0
max 2107
oom 0
oom_kill 0
oom_group_kill 0
```

`si` and `so` are far above zero (about 18 MB per second in each direction): the machine is moving memory to and from swap, which is saturation. Yet `free -m` shows 3900 MB `available`, so the machine as a whole is not out of memory. The cgroup files explain the contradiction: the process may use at most `209715200` bytes (200 MB), it is using `209526784`, and the 100 MB it cannot keep in RAM sits in swap (`109576192`). `max 2107` counts how often it reached its limit. No OOM kill happened because swap absorbed the excess. If you repeat it with `-p MemorySwapMax=0` (Lab 1.2), it dies instead.

1. Which command would tell you *which process* is thrashing? Which of the four resources looked fine in `free -m`, and why was that misleading?
2. `oom_kill` is `0`. In what sense is this incident worse than an OOM kill for the wallet's *latency*, and in what sense better for its *data*?
3. Ch 1.5 will define these cgroup files. Predict what `memory.max` is for a Kubernetes container with `resources.limits.memory: 200Mi`.

### Incident 3 (`./fault.sh disk 25`)

```bash
iostat -dxz 1 3
pidstat -d 1 2
ls -l ~/cn-lab/slow/junk
```

```text
Device   r/s    rkB/s    w/s    wkB/s   wrqm/s  aqu-sz  %util        (columns trimmed; sdd is the root disk)
sdd     6.00    68.00 470.00  4460.00   644.00    1.25  73.20
sdd     1.00     4.00 631.00  5904.00   846.00    1.41  80.00

Average:      UID       PID   kB_rd/s   kB_wr/s kB_ccwr/s iodelay  Command
Average:     1000      2724      0.00     25.87      0.00       0  claude
Average:     1000    174250      0.00    788.06      0.00       0  dd
```

The disk is 73 to 80 percent busy while moving only about 5 MB per second: 470 to 631 writes per second, each tiny. `pidstat -d` names the writer, `dd`, and `ls -l` shows its file growing. The fault wrote 4 KB blocks with `oflag=dsync`, so every write waits until the disk confirms it.

1. High `%util` with low throughput: what does that say about the *size* of each request?
2. `aqu-sz` is only about 1.3. How would the numbers differ if the same data were written in one large block, and why would the wallet's `fsync` calls feel the difference?
3. The theory warned about `%util` on devices that serve requests in parallel. Is this disk such a device? What would you check to be sure?

### Incident 4 (`./fault.sh net 25`)

```bash
ss -ltn 'sport = :9000'
ss -s | head -3
nstat -az TcpExtListenOverflows TcpExtListenDrops TcpExtTCPSynRetrans
ss -tn state syn-sent '( dport = :9000 )' | head -4
```

```text
State  Recv-Q Send-Q Local Address:Port Peer Address:Port
LISTEN 2      1          127.0.0.1:9000      0.0.0.0:*
Total: 726
TCP:   557 (estab 47, closed 379, orphaned 9, timewait 11)

#kernel
TcpExtListenOverflows           2379               0.0
TcpExtListenDrops               2379               0.0
TcpExtTCPSynRetrans             1853               0.0
Recv-Q Send-Q Local Address:Port  Peer Address:Port
0      1          127.0.0.1:36022    127.0.0.1:9000
0      1          127.0.0.1:36038    127.0.0.1:9000
```

CPU, memory and disk are quiet. The listening socket on port 9000 has `Recv-Q 2` against `Send-Q 1`: two connections wait in a queue of size one, so the kernel drops the rest and counts them in `ListenOverflows`. The clients sit in `SYN-SENT` and retransmit (`TcpExtTCPSynRetrans`). The counters are totals since boot, so run `nstat -az` twice and subtract, or use `nstat` without `-a`, which prints only the change since its last call. This is an *error* signal on the network, found while every utilization number was low.

1. Which letter of USE caught this, and which of the ten commands from Part C would have shown it? Which would have missed it entirely?
2. What must the server program do, or what must you change, for these connections to succeed?
3. Copy the table below into your notebook and fill it for each incident: which resources you *exonerated* and by which command.

| Incident | Resource | U, S or E | Command that proved it | Exonerated (and how) |
| --- | --- | --- | --- | --- |
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |
| 4 |  |  |  |  |

## Part E · A health-check script and a chart (45 min)

You will turn the USE loop into one script that exits non-zero when something is wrong, then record all four faults in one run and plot what the machine really did.

Type this into `~/cn-lab/slow/healthcheck.sh`. It reads the kernel's counters twice, one second apart, so that rates are *now* and not since boot, and prints one line per resource:

```bash
cat > healthcheck.sh <<'EOF'
#!/usr/bin/env bash
# healthcheck.sh : one line per resource, USE style. Exit 0 = all OK, 1 = a WARN, 2 = a CRIT.
set -euo pipefail

worst=0
say() {                                   # say OK|WARN|CRIT "text"
  printf '%-4s %s\n' "$1" "$2"
  if [[ $1 == WARN && $worst -lt 1 ]]; then worst=1; fi
  if [[ $1 == CRIT ]]; then worst=2; fi
}
level() {                                 # level VALUE WARN CRIT -> OK|WARN|CRIT (higher is worse)
  awk -v v="$1" -v w="$2" -v c="$3" 'BEGIN { print (v >= c) ? "CRIT" : (v >= w) ? "WARN" : "OK" }'
}

dev=$(basename "$(findmnt -no SOURCE /)")
snap() {                                  # raw counters: idle total swapout disk_ms drops
  awk -v dev="$dev" '
    FILENAME=="/proc/stat" && $1=="cpu" { idle=$5; for (i=2;i<=NF;i++) total+=$i }
    FILENAME=="/proc/vmstat" && $1=="pswpout" { swp=$2 }
    FILENAME=="/proc/diskstats" && $3==dev { io=$13 }
    FILENAME=="/proc/net/netstat" && $1=="TcpExt:" && !h { h=1; for (i=2;i<=NF;i++) if ($i=="ListenDrops") c=i; next }
    FILENAME=="/proc/net/netstat" && $1=="TcpExt:" { drops=$c }
    END { print idle, total, swp, io, drops }' /proc/stat /proc/vmstat /proc/diskstats /proc/net/netstat
}
read -r i0 t0 s0 b0 d0 < <(snap)
sleep 1
read -r i1 t1 s1 b1 d1 < <(snap)

# CPU: utilisation (busy percent) and saturation (runnable tasks per core)
busy=$(( 100 * ( (t1 - t0) - (i1 - i0) ) / (t1 - t0) ))
runq=$(awk '/^procs_running/ { print $2 - 1 }' /proc/stat)
per_core=$(awk -v r="$runq" -v n="$(nproc)" 'BEGIN { printf "%.1f", r / n }')
say "$(level "$busy" 85 98)" "cpu    busy ${busy}%"
say "$(level "$per_core" 1 2)" "cpu    ${runq} runnable tasks on $(nproc) cores (${per_core} per core)"

# Memory: utilisation (available), saturation (swapping), errors (OOM kills)
avail=$(awk '/^MemAvailable/ { a=$2 } /^MemTotal/ { t=$2 } END { printf "%d", 100 * (t - a) / t }' /proc/meminfo)
swapout=$(awk -v n=$(( s1 - s0 )) 'BEGIN { printf "%.1f", n * 4 / 1024 }')
oom_now=$(awk '/^oom_kill / { print $2 }' /proc/vmstat)
state="${XDG_STATE_HOME:-$HOME/.local/state}/healthcheck-oom"          # the count at the previous run
mkdir -p "$(dirname "$state")"
oom=$(( oom_now - $(cat "$state" 2>/dev/null || echo "$oom_now") ))
echo "$oom_now" > "$state"
say "$(level "$avail" 85 95)" "memory ${avail}% in use"
say "$(level "$swapout" 1 20)" "memory swapping out ${swapout} MB/s"
say "$(level "$oom" 1 1000000)" "memory ${oom} OOM kills since the last run"

# Disk: utilisation (busy percent, space) and saturation
dbusy=$(( (b1 - b0) / 10 ))
space=$(df --output=pcent / | tail -1 | tr -dc 0-9)
say "$(level "$dbusy" 70 95)" "disk   ${dev} busy ${dbusy}%"
say "$(level "$space" 85 95)" "disk   / is ${space}% full"

# Network: errors (connections dropped because a listen queue was full)
drops=$(( d1 - d0 ))
say "$(level "$drops" 1 50)" "net    ${drops} connections dropped this second"

# The service itself
if curl -fs --max-time 2 -o /dev/null http://localhost:8080/alice; then
  say OK "wallet answers on :8080"
else
  say CRIT "wallet does not answer on :8080"
fi

exit "$worst"
EOF
chmod +x healthcheck.sh && shellcheck healthcheck.sh
```

Notice what Part A taught, applied: `set -euo pipefail` on top; `say` uses `if` blocks instead of `[[ ... ]] && worst=1`, because a failed test at the end of an `&&` list would make the *function* return non-zero and `set -e` would end the script; and the OOM count is stored between runs, since an error counter that says "11 since boot" is a permanent WARN. Run it with the wallet up and nothing else going on:

```bash
./healthcheck.sh; echo "exit=$?"
```

```text
OK   cpu    busy 54%
OK   cpu    9 runnable tasks on 12 cores (0.8 per core)
OK   memory 53% in use
OK   memory swapping out 0.0 MB/s
OK   memory 0 OOM kills since the last run
OK   disk   sdd busy 2%
OK   disk   / is 3% full
OK   net    0 connections dropped this second
OK   wallet answers on :8080
exit=0
```

Now start each fault in terminal 1 and run the script a few times in terminal 2 (`for i in 1 2 3 4 5; do ./healthcheck.sh | grep -v '^OK'; echo; done`). What the test machine printed:

| Fault | Lines that fired | Exit code |
| --- | --- | --- |
| `cpu` | `CRIT cpu    busy 99%` and `CRIT cpu    74 runnable tasks on 12 cores (6.2 per core)` | `2` |
| `mem` | `CRIT memory swapping out 106.1 MB/s`, but only in 3 of 5 runs; the other two said `OK ... 0.0 MB/s` | `2` or `0` |
| `disk` | `WARN disk   sdd busy 76%` | `1` |
| `net` | `CRIT net    138 connections dropped this second` | `2` |

The memory row is the lesson: swapping came in bursts, so a one-second sample sometimes landed between two bursts. A health check that runs once a minute would miss such a fault most of the time. That is why the 60-second routine uses `vmstat 1`, a *stream* of samples, and why monitoring systems keep a history. To see the whole picture, record it. Type `sample.sh`, which prints one CSV row per second for the four signals:

```bash
cat > sample.sh <<'EOF'
#!/usr/bin/env bash
# sample.sh SECONDS : one CSV row per second, one column per resource signal
#   runq = runnable tasks, cpu = busy %, swapout = MB/s written to swap,
#   busy = % of time the disk had work, await = average wait per disk request in ms,
#   drops = TCP connections dropped per second (listen queue full)
set -euo pipefail
dev=$(basename "$(findmnt -no SOURCE /)")             # the disk that holds /
snap() {                                              # one line of raw counters
  awk -v dev="$dev" '
    FILENAME=="/proc/stat" && $1=="cpu" {idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i}
    FILENAME=="/proc/stat" && $1=="procs_running" {runq=$2}
    FILENAME=="/proc/vmstat" && $1=="pswpout" {swp=$2}
    FILENAME=="/proc/diskstats" && $3==dev {ios=$4+$8; ms=$7+$11; io=$13}
    FILENAME=="/proc/net/netstat" && $1=="TcpExt:" && !h {h=1; for(i=2;i<=NF;i++) if($i=="ListenDrops") c=i; next}
    FILENAME=="/proc/net/netstat" && $1=="TcpExt:" {drops=$c}
    END {print idle, total, runq, swp, ios, ms, io, drops}' /proc/stat /proc/vmstat /proc/diskstats /proc/net/netstat
}
read -r i0 t0 _ s0 n0 m0 b0 d0 < <(snap)
echo "t,runq,cpu,swapout,busy,await,drops"
for t in $(seq "$1"); do
  sleep 1
  read -r i1 t1 q s1 n1 m1 b1 d1 < <(snap)
  awk -v t="$t" -v q="$q" -v di=$((i1-i0)) -v dt=$((t1-t0)) -v ds=$((s1-s0)) -v dn=$((n1-n0)) -v dm=$((m1-m0)) -v db=$((b1-b0)) -v dd=$((d1-d0)) 'BEGIN {
    printf "%d,%d,%.0f,%.1f,%.0f,%.1f,%d\n", t, q, 100*(1-di/dt), ds*4/1024, db/10, (dn>0 ? dm/dn : 0), dd}'
  i0=$i1 t0=$t1 s0=$s1 n0=$n1 m0=$m1 b0=$b1 d0=$d1
done
EOF
chmod +x sample.sh && shellcheck sample.sh
```

Run the four faults back to back while it records (about 75 seconds), then look at the file:

```bash
./sample.sh 72 > drill.csv &
sleep 8; ./fault.sh cpu 10; sleep 5; ./fault.sh mem 10; sleep 5; ./fault.sh disk 10; sleep 5; ./fault.sh net 10
wait; head -3 drill.csv
```

```text
t,runq,cpu,swapout,busy,await,drops
1,2,32,0.0,0,0.0,0
2,1,12,0.0,0,0.0,0
```

The chart below is the test machine's own `drill.csv`: 72 rows, four columns plotted. Open yours in a spreadsheet or plot it with any tool, and compare.

{{diagram lab-1-4-02.jsx | measured on the test machine, 2026-11-16 · sample.sh, 72 one-second samples across four 10-second faults}}

Every fault lights up its own panel, and the panels it does not belong to stay at the background level of the shared machine. The CPU fault is the only one visible as a run queue far above the dashed 12-core line. The memory fault shows as short swap bursts (the same bursts that made `healthcheck.sh` flicker). The disk fault holds the disk at a steady high busy level with little data moving. The network fault grows by itself, because every client that is turned away retries, so the number of drops per second climbs as more of them pile up.

1. Which of the four faults would a monitoring system that scrapes once a minute most likely miss? Which would it catch every time?
2. Add a fifth check to `healthcheck.sh` that you choose (`df -i` for inodes, the I/O pressure file, or an `ss` check on port 8080). Which letter of USE does it cover, and what are your two thresholds?
3. Why does `healthcheck.sh` test the wallet last, and why does a `CRIT` there not tell you *which* resource is to blame?

## Checkpoint

You are done when all of these hold. Commit `~/cn-lab/safe/good.sh`, `~/cn-lab/slow/` (the three scripts and `drill.csv`), `~/cn-lab/ssh/config` and `sshd_config` (never the keys), and `~/cn-lab/lab-1.4.md`.

| Check | Expected |
| --- | --- |
| `shellcheck ~/cn-lab/safe/good.sh ~/cn-lab/slow/*.sh` | no output |
| `~/cn-lab/safe/good.sh; echo $?` with `BACKUP_DIR` unset | `BACKUP_DIR: set BACKUP_DIR`, then `1` |
| `ssh -F ~/cn-lab/ssh/config lab true; echo $?` with your `sshd` running | `0` |
| `ssh-keygen -lf ~/cn-lab/ssh/client_key.pub` | `256 SHA256:... cn-lab client (ED25519)` |
| `~/cn-lab/slow/healthcheck.sh; echo $?` on a quiet machine with the wallet running | nine `OK` lines and `0` |
| `~/cn-lab/slow/healthcheck.sh` while `./fault.sh cpu 25` runs | a `CRIT cpu` line and exit status `2` |
| `head -1 ~/cn-lab/slow/drill.csv` | `t,runq,cpu,swapout,busy,await,drops` |
| Notebook | Answers to Parts A to E and the filled incident table |

## Break it: every dashboard green, the wallet silent

The wallet is a single-threaded server (Lab 1.2 never asked it to serve two clients at once). Start it, then open a connection that connects and then says nothing, and try a normal request:

```bash
(cd ~/cn-lab/wallet && ./wallet.py &)
python3 -c "import socket, time; s = socket.create_connection(('127.0.0.1', 8080)); time.sleep(120)" &
curl -s -m 3 -w ' http=%{http_code} %{time_total}s\n' localhost:8080/alice; echo "curl-exit=$?"
```

```text
 http=000 3.001919s
curl-exit=28
```

The request timed out (curl exit code `28`). Now run `~/cn-lab/slow/healthcheck.sh`. On an idle machine every resource line is `OK` and only the last line says `CRIT wallet does not answer on :8080`. Diagnose it without `sudo`:

```bash
WP=$(pgrep -f 'python3 ./wallet.py')
ps -o pid,stat,wchan:20,pcpu,comm -p $WP
ss -tnp 'sport = :8080'
ls -l /proc/$WP/fd | tail -3
```

```text
    PID STAT WCHAN                %CPU COMMAND
  99036 S    wait_woken            0.1 python3
State      Recv-Q Send-Q Local Address:Port Peer Address:Port Process
CLOSE-WAIT 84     0          127.0.0.1:8080    127.0.0.1:59972
ESTAB      0      0          127.0.0.1:8080    127.0.0.1:59946 users:(("python3",pid=99036,fd=4))
lrwx------+ 1 student  student  64 Nov 16 14:44 3 -> socket:[839828]
lrwx------+ 1 student  student  64 Nov 16 14:44 4 -> socket:[885900]
```

1. All four resources are exonerated, so where is the time going? Read the three outputs: what is the wallet doing (state, CPU), which connection does it hold in `ESTAB`, and what is the `84` in `Recv-Q` on the other connection?
2. `strace -p $WP` would show the call the wallet is blocked in. On the test machine it answered `ptrace(PTRACE_SEIZE, ...): Operation not permitted`. The Linux [Yama documentation](https://docs.kernel.org/admin-guide/LSM/Yama.html) says what value of `ptrace_scope` causes this; read `/proc/sys/kernel/yama/ptrace_scope` and explain, then say what the authors did not run (`sudo strace -p`).
3. Fix it by changing `HTTPServer` to `ThreadingHTTPServer` in a copy of `wallet.py` (two words, in the import and in the last line) and repeat the experiment. On the test machine the same `curl` then answered `http=200` in 3 ms while the silent client was still connected.
4. Which Kubernetes mechanism could detect this failure automatically, instead of a person running `curl`? (Hint: Kubernetes probes; you do not need the details yet.)
