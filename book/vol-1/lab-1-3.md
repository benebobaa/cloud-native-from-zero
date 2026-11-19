# Lab 1.3 · Filesystems, Boot and systemd

## Goal

You will see inodes and links behave, build an OverlayFS by hand, run the wallet as a systemd service that comes back after a crash, back it up on a schedule, and solve a "disk full" mystery.

**Versions tested** (2026-11-16, Ubuntu 26.04 on WSL2, kernel 6.18): systemd 259, cron from Ubuntu. Parts B to D need no `sudo`. You need the graceful wallet from Lab 1.2 in `~/cn-lab/wallet/`.

### What you will build

{{diagram lab-1-3-01.jsx | what you will see in Lab 1.3 · one panel per part}}

## Part A · Inodes and links (30 min)

```bash
mkdir -p ~/cn-lab/fs && cd ~/cn-lab/fs
echo hello > a.txt
ln a.txt hard.txt
ln -s a.txt soft.txt
ls -li a.txt hard.txt soft.txt
stat -c '%n inode=%i links=%h' a.txt
```

`a.txt` and `hard.txt` show the **same** inode number and a link count of `2`; `soft.txt` has its own inode and an arrow `-> a.txt`. *Predict*, then run:

```bash
rm a.txt
cat hard.txt
cat soft.txt
```

Compare what happened with your prediction. Finally, look at where your files live:

```bash
df -h ~ ; df -i ~
findmnt -T ~
lsblk
```

1. Why did deleting `a.txt` not delete the data?
2. `soft.txt` still exists, yet `cat` says "No such file". Which file is missing?
3. From `findmnt -T ~`: which device and filesystem type hold your home directory?

## Part B · OverlayFS by hand (45 min)

You will build the three-layer picture from the theory with real directories. Mounting normally needs root; `unshare -rm` gives you a private mount namespace where you are allowed to mount (Ch 1.5 explains how), and the mount disappears when that shell exits.

```bash
mkdir -p ~/cn-lab/overlay && cd ~/cn-lab/overlay
mkdir -p lower upper work merged
echo "from lower"   > lower/base.txt
echo "lower config" > lower/config.txt
unshare -rm bash
```

You are now in a new shell. Mount the overlay and change it:

```bash
mount -t overlay overlay \
  -o lowerdir=$PWD/lower,upperdir=$PWD/upper,workdir=$PWD/work $PWD/merged
ls merged
echo "changed" > merged/config.txt
echo "new"     > merged/new.txt
rm merged/base.txt
ls merged
exit
```

Back in your normal shell, look at the layers themselves:

```bash
ls lower;  cat lower/config.txt
ls -la upper
```

On the test machine `lower/` still held `base.txt` and `lower config`, untouched, and `upper/` held three entries: `config.txt` and `new.txt`, plus `c--------- ... 0, 0 base.txt`.

1. Which rule from the theory put `config.txt` into `upper/`?
2. What is the strange `c` entry called, and what would happen if you deleted it from `upper/` and mounted again?
3. Mount it again (`unshare -rm bash`, same `mount` line) and run `cat merged/config.txt`. Which layer did the content come from?

## Part C · A wallet that restarts itself (45 min)

You will hand the wallet to systemd, crash it on purpose, and watch it come back without you.

Create `~/.config/systemd/user/wallet.service` with the unit file from the theory section (`mkdir -p ~/.config/systemd/user` first). Then:

```bash
systemctl --user daemon-reload
systemctl --user start wallet
systemctl --user status wallet --no-pager
curl localhost:8080/alice
```

`status` shows `Active: active (running)` and a `Main PID`. Now crash it the hard way and watch:

```bash
kill -KILL $(systemctl --user show -p MainPID --value wallet)
sleep 3
systemctl --user show -p MainPID,NRestarts,ActiveState wallet
journalctl --user -u wallet -n 6 --no-pager
```

On the test machine the journal showed, in order: `Main process exited, code=killed, status=9/KILL`, `Scheduled restart job, restart counter is at 1`, `Started wallet.service`, and the wallet's own start-up line with a new PID. `NRestarts` was `1`.

Finally stop it properly with `systemctl --user stop wallet` and read the journal again: your Lab 1.2 `SIGTERM` handler printed `got SIGTERM, shutting down`.

1. Why did systemd restart the wallet after `kill -KILL`, but not after `systemctl stop`? Find the rule in [systemd.service(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) under `Restart=`.
2. Where did the wallet's stderr output go, now that no terminal is attached?
3. Run `systemctl --user enable wallet`. What file did that create, and what does it mean for your next login?

User services stop when you log out unless your account has *lingering* turned on (`loginctl enable-linger`); system services in `/etc/systemd/system` do not have this limit.

## Part D · Scheduled backups (30 min)

You will back up `balances.json` on a schedule twice: with a systemd timer and with cron, then compare them.

**Timer.** Create `~/.config/systemd/user/wallet-backup.service`:

```ini
[Unit]
Description=Back up wallet balances

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'mkdir -p %h/cn-lab/wallet/backups && cp %h/cn-lab/wallet/balances.json %h/cn-lab/wallet/backups/balances-$(date +%%H%%M%%S).json'
```

and `~/.config/systemd/user/wallet-backup.timer`:

```ini
[Unit]
Description=Back up wallet balances every minute

[Timer]
OnActiveSec=10s
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
```

```bash
systemctl --user daemon-reload
systemctl --user start wallet-backup.timer
systemctl --user list-timers --no-pager
```

Wait two minutes, then `ls ~/cn-lab/wallet/backups/`. In a unit file `%` has a meaning of its own (`%h` is your home), so a literal `%` for `date` must be written `%%`.

**cron.** Run `crontab -e` and add one line:

```text
*/2 * * * * cp $HOME/cn-lab/wallet/balances.json $HOME/cn-lab/wallet/backups/cron-$(date +\%H\%M).json
```

cron has the same problem with `%`, solved differently: a backslash. After four minutes you should see `cron-*.json` files too. (The authors tested the timer but not this cron line, so checking it is part of your job.)

1. Compare `journalctl --user -u wallet-backup -n 5` with what cron tells you about its runs. Which would you rather debug at 3 a.m.?
2. Turn the laptop off for an hour at the moment a 02:00 backup should run. Which tool can catch up, and with which option?

**Clean up:** `systemctl --user stop wallet-backup.timer`, and remove your line with `crontab -e` (not `crontab -r`, which deletes all your cron jobs).

## Checkpoint

Copy your three unit files into `~/cn-lab/units/` and commit them with `~/cn-lab/fs` and `~/cn-lab/lab-1.3.md`. Do not commit `~/cn-lab/overlay`: git cannot store the whiteout device file.

| Check | Expected |
| --- | --- |
| `stat -c %h ~/cn-lab/fs/hard.txt` | `1` (it was `2` before you deleted `a.txt`) |
| `ls -la ~/cn-lab/overlay/upper` | `config.txt`, `new.txt` and a `c` whiteout for `base.txt` |
| `systemctl --user show -p NRestarts wallet` after one `kill -KILL` | `NRestarts=1` |
| `ls ~/cn-lab/wallet/backups/ \| wc -l` after two minutes of the timer | `2` or more |
| Notebook | Answers to Parts A to D |

## Break it: the disk that would not empty

A log file fills the disk, you delete it, and nothing changes. Reproduce it:

```bash
cd ~/cn-lab/fs
df -m . | tail -1
dd if=/dev/zero of=big.log bs=1M count=500 status=none
tail -f big.log > /dev/null &
df -m . | tail -1
rm big.log
df -m . | tail -1
```

On the test machine the used space rose by 500 MB, and stayed 500 MB higher after `rm`.

1. Using the link-count rule from the theory, explain why `rm` freed nothing.
2. Find the culprit two ways: `lsof +L1`, and `ls -l /proc/$!/fd`. What word appears at the end of the file's name?
3. Free the space without rebooting. Then confirm with `df` that it is back.
4. In production the "`tail`" is usually a long-running service holding its old log file. What should a service do when its log file is rotated, and which signal do many daemons use to be told so?
