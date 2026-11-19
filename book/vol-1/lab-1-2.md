# Lab 1.2 · Processes, System Calls and Memory

## Goal

You will watch the wallet talk to the kernel, build and inspect a process tree, make the wallet shut down gracefully, and get a program killed by the OOM killer on purpose.

**Versions tested** (2026-11-16, Ubuntu 26.04 on WSL2): strace 6.19, Python 3.14, systemd user session. Every output shown below came from those runs; on Ubuntu 24.04 the PIDs and timestamps differ, the shapes do not.

**Before you start:** `sudo apt install -y strace`, and have wallet v0 from Lab 1.1 in `~/cn-lab/wallet/`. Keep two terminals open.

### What you will build

{{diagram lab-1-2-01.jsx | what you will see in Lab 1.2 · one panel per part}}

## Part A · Watch the wallet's system calls (45 min)

You will record every request the wallet makes to the kernel while it serves one HTTP call.

In **terminal 1**, start the wallet under `strace`, logging only the calls that matter to a file:

```bash
cd ~/cn-lab/wallet
strace -f -e trace=socket,bind,listen,accept4,openat,read,sendto,write,close \
       -o wallet.trace ./wallet.py
```

In **terminal 2**, send one request, then stop the wallet:

```bash
curl localhost:8080/alice
kill -TERM $(pgrep -f 'python3 ./wallet.py')
```

Now read the end of the trace. Python's start-up opens hundreds of library files; skip them:

```bash
grep -v -e ENOENT -e /usr/lib -e '\.py' -e '\.so' wallet.trace | tail -15
```

You should see `listen`, then `accept4` returning descriptor 4, `openat(... "balances.json" ...)` returning 5, a `read` of 26 bytes, `write(2, ...)` for the log line, two `sendto` calls and finally `+++ killed by SIGTERM +++`.

Now count instead of list:

```bash
strace -c ls / > /dev/null
```

The summary table shows which system calls `ls` used most (`mmap`, `read` and `openat` are near the top) and how many of them failed.

1. Match each line of the trimmed trace to a line of `wallet.py`. Which Python line produced the `openat`?
2. Why does `accept4` return 4 and `openat` return 5, not 0 or 1?
3. In the `strace -c` output, some `openat` calls show under `errors`. What were they looking for? Hint: run `strace -e trace=openat ls /` and read the failures.

## Part B · Fork, exec and a zombie (45 min)

You will see the fork-exec-wait cycle happen, then break it on purpose to create a zombie.

```bash
echo $$                         # your shell's PID
pstree -p $$                    # your shell and its children
strace -f -e trace=clone,clone3,execve,wait4 bash -c 'ls / > /dev/null; echo done'
```

In the trace, find three things: a `clone` or `clone3` call that returns a new PID (this is Linux's `fork`), an `execve("/usr/bin/ls", ...)` line marked with that new PID, and a `wait4` in the parent that returns the same PID with `WEXITSTATUS(s) == 0`.

Now make a parent that never calls `wait`. Save as `~/cn-lab/zombie.py`:

```python
import os, time
pid = os.fork()
if pid == 0:
    os._exit(0)            # the child exits at once
print(f"parent {os.getpid()} child {pid}", flush=True)
time.sleep(60)             # the parent never calls wait()
```

```bash
python3 ~/cn-lab/zombie.py &
ps -o pid,ppid,stat,comm --ppid $!
```

The child shows state `Z`:

```text
    PID    PPID STAT COMMAND
  22154   22152 Z    python3
```

1. *Predict:* try `kill -KILL <zombie PID>`. Does the zombie disappear? Why or why not?
2. Now kill the **parent** with `kill $!`, then look for the zombie again with `ps -p <zombie PID>`. Who collected its exit code?
3. In the `strace` output above, why does the `execve` line keep the child's PID instead of getting a new one?

## Part C · Signals and a graceful wallet (45 min)

You will prove the exit-code table from the theory, then teach the wallet to stop cleanly on `SIGTERM`.

**Exit codes.** Write your prediction for each line, then run it:

```bash
false; echo $?
nosuchcommand; echo $?
sleep 60 & kill -TERM $!; wait $!; echo $?
sleep 60 & kill -KILL $!; wait $!; echo $?
sleep 60          # press Ctrl+C, then:
echo $?
```

The answers on the test machine were `1`, `127`, `143`, `137` and `130`.

**A trap.** Run this, then send it `SIGTERM` from terminal 2 with `kill -TERM <pid>`:

```bash
bash -c 'echo "pid $$"; trap "echo got TERM, cleaning up; exit 0" TERM; sleep 600 & wait'
```

It prints `got TERM, cleaning up` and exits with `0`.

**A graceful wallet.** Wallet v0 dies on `SIGTERM` with exit code `143` and no message. Add a handler. Change the import line and add four lines just above the final `print`:

```python
import json, os, signal, sys

def stop(signum, frame):
    print("wallet v0: got SIGTERM, shutting down", file=sys.stderr, flush=True)
    sys.exit(0)

signal.signal(signal.SIGTERM, stop)
```

Start it with `./wallet.py`, send one `curl` request, then `kill -TERM` it. Terminal 1 now ends with `wallet v0: got SIGTERM, shutting down`, and `echo $?` there prints `0`.

1. Why can the wallet catch `SIGTERM` but never `SIGKILL`? Who benefits from that rule?
2. Kubernetes waits 30 seconds after `SIGTERM` before sending `SIGKILL`. What should a real payment service do during those 30 seconds?

## Part D · Memory and the OOM killer (45 min)

You will see the difference between mapped and resident memory, watch the page cache fill, and get a program killed for exceeding a memory limit, exactly as a Kubernetes container would be.

**Resident memory.** With the wallet running:

```bash
PID=$(pgrep -f 'python3 ./wallet.py')
grep -E 'State|VmSize|VmRSS' /proc/$PID/status
```

`VmSize` (everything mapped) is larger than `VmRSS` (what is really in RAM); on the test machine 30.7 MB against 19.6 MB. For big programs such as databases or Java services the gap is often much wider.

**The page cache.** Run `free -h` and note `buff/cache`. Read a few hundred megabytes of files, then look again:

```bash
cat /usr/bin/* > /dev/null 2>&1
free -h
```

`buff/cache` grew and `free` shrank, but `available` barely moved.

**The OOM killer.** `systemd-run` puts a command in its own cgroup with a 50 MB memory limit; no root is needed. The Python one-liner allocates 1 MB at a time, forever:

```bash
systemd-run --user --scope -p MemoryMax=50M -p MemorySwapMax=0 \
  python3 -c 'b=[]
while True: b.append(bytearray(10**6))'
echo $?
journalctl --user -n 5 --no-pager
```

Within a second bash prints `Killed`, `echo $?` prints `137`, and the journal says `The kernel OOM killer killed some processes in this unit` and `Failed with result 'oom-kill'`.

This is what it looked like from the kernel's side on the test machine, with the program slowed to 1 MB every 40 ms so the climb can be sampled:

{{diagram lab-1-2-02.jsx | measured on the test machine, 2026-11-16 · 28 samples up to the kill; the one reading after the kill is left out}}

The process never got an error or a warning: memory simply reached the limit and the kernel ended it. A Kubernetes container with `resources.limits.memory: 50Mi` dies in exactly this way.

1. Why did `available` barely change when `free` dropped?
2. Exit code `137` = 128 + ?. Which signal was that, and could Python have caught it?
3. This is the same mechanism as a Kubernetes container memory limit. Write the one-line explanation you would give a teammate whose Pod shows `OOMKilled`.

## Checkpoint

You are done when all of these hold. Commit `wallet.trace`, the new `wallet.py`, `zombie.py` and `~/cn-lab/lab-1.2.md`.

| Check | Expected |
| --- | --- |
| `grep -c -e accept4 -e sendto ~/cn-lab/wallet/wallet.trace` | `3` or more |
| `grep balances.json ~/cn-lab/wallet/wallet.trace` | an `openat` line returning a number, not `-1` |
| `kill -TERM` the new wallet, then `echo $?` in its terminal | `wallet v0: got SIGTERM, shutting down`, then `0` |
| The `systemd-run` OOM test, then `echo $?` | `Killed`, then `137` |
| Notebook | Answers to the questions in Parts A to D, including your zombie's PID and state |

## Break it: the wallet that would not die

Teams often start a service from a small wrapper script. Save this as `~/cn-lab/wallet/run.sh`, make it executable, and start it in terminal 1:

```bash
#!/bin/bash
python3 ./wallet.py
```

In terminal 2, stop the *script* politely and check on the wallet:

```bash
kill -TERM $(pgrep -f run.sh)
curl localhost:8080/alice
ps -o pid,ppid,comm -p $(pgrep -f 'python3 ./wallet.py')
```

The script is gone, but the wallet still answers, and its parent PID has changed.

1. Explain what happened, using the words *orphan* and *signal*. Which process received `SIGTERM`, and which did not?
2. Who adopted the wallet? On the test machine it was not PID 1; find out what your adopter is with `ps -p <ppid> -o comm,args`.
3. Fix the script by changing its last line to `exec python3 ./wallet.py`, and repeat. Why does `exec` fix it? (Think about what `exec` does to the shell's own process.)
4. In Ch 4 you will write container start commands. Why does this bug matter even more when the script is PID 1 of a container?
