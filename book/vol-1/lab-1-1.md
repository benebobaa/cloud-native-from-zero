# Lab 1.1 · Shell, Files and Permissions

## Goal

You will answer real questions about your machine with one-line pipelines, solve permission puzzles by predicting before you run, and start the first version of the wallet as a plain Linux process.

**Versions targeted** (2026-11-16): Ubuntu 24.04 LTS, bash 5, GNU coreutils, Python 3.12 from Ubuntu. Part D was run on Ubuntu 26.04 with Python 3.14 and gave the outputs shown.

**Rule for this lab: predict, then run.** Before each command marked *Predict*, write your prediction in `~/cn-lab/lab-1.1.md`. Then run it and write down what happened. A wrong prediction you correct teaches more than a right one you guessed.

### What you will build

{{diagram lab-1-1-01.jsx | what you will build in Lab 1.1}}

## Part A · Find your way around (30 min)

Walk the tree from the theory section and see each directory for yourself.

```bash
pwd                      # where am I?
ls /                     # the top of the tree
ls -la ~                 # your home, hidden files included
ls -l /bin               # Predict: a directory, or something else?
cat /etc/os-release      # configuration is plain text
cat /proc/loadavg        # not a real file: the kernel writes it as you read
ls /proc | head          # numbers are running processes
echo $PATH | tr ':' '\n' # where the shell looks for programs
which ls python3         # which file runs when you type the name
```

Answer in your notebook:

1. What does `ls -l /bin` show, and what does the arrow mean?
2. Run `cat /proc/loadavg` three times. Does it change? How can a "file" change when nobody writes to it?
3. `cd /proc/$$` then `ls`. `$$` is your shell's process ID. Run ls -l on cwd, exe and fd. In one line each, say what they show about your shell.

## Part B · Pipes and redirection (45 min)

Each line below answers one question about the machine by joining small tools.

```bash
ps aux | wc -l                                   # how many processes (plus one header line)?
cut -d: -f1,7 /etc/passwd | head -5              # user names and their login shells
cut -d: -f7 /etc/passwd | sort | uniq -c | sort -rn | head -3   # most common login shells
ls -S /usr/bin | head -3                         # the three largest programs
du -sh /usr/* 2>/dev/null | sort -h | tail -3    # the three largest directories under /usr
```

Now redirect output and errors separately:

```bash
cd ~/cn-lab
echo hello > out.txt; echo again >> out.txt; cat out.txt
ls /nonexistent > out.txt 2> err.txt; echo "exit code: $?"
cat out.txt err.txt
```

Run the second block and check: the `ls` line prints nothing on the screen, and the exit code is not `0`. Then look inside both files.

1. *Predict:* why is `out.txt` empty now, when it held two lines a moment ago?
2. In the `du` line, what does `2>/dev/null` hide, and why is hiding it acceptable there but dangerous in a script?
3. **Challenge.** Write one pipeline that prints how many *different* login shells appear in `/etc/passwd`. Hint: `sort -u` and `wc -l`.

## Part C · Permission puzzles (60 min)

You will create a second user, `eve`, and a group, `wallet`, then predict who can do what. The machine is the answer key.

**Set up.** Work in `/srv/lab`, not your home directory: on Ubuntu, home directories are closed to other users, which would hide every puzzle behind the same error.

```bash
sudo groupadd wallet
sudo useradd -m -s /bin/bash -G wallet eve
sudo mkdir /srv/lab
sudo chown $USER:wallet /srv/lab
sudo chmod 750 /srv/lab
cd /srv/lab
echo "alice=100" > balances.txt
ls -l balances.txt
id eve
```

The starting mode ls shows depends on your umask (Ubuntu usually gives 664); note it, then run each puzzle as written. To restart this part from scratch, run the Clean up block first. Before each *Try as eve* line, write your prediction: works, or `Permission denied`.

| # | Set up | Try as eve |
| --- | --- | --- |
| 1 | `chmod 640 balances.txt` | `sudo -u eve cat /srv/lab/balances.txt` |
| 2 | sudo `chgrp wallet balances.txt` | `sudo -u eve cat /srv/lab/balances.txt` |
| 3 | `chmod 600 balances.txt` | `sudo -u eve cat /srv/lab/balances.txt` |
| 4 | `chmod 640 balances.txt; chmod 740 /srv/lab` | `sudo -u eve ls -l /srv/lab` then `sudo -u eve cat /srv/lab/balances.txt` |
| 5 | `chmod 710 /srv/lab` | `sudo -u eve ls /srv/lab` then `sudo -u eve cat /srv/lab/balances.txt` |
| 6 | `chmod 770 /srv/lab; chmod 600 balances.txt` | `sudo -u eve rm -f /srv/lab/balances.txt` |

Then explain in your notebook:

1. Why did puzzle 1 fail and puzzle 2 work, when the mode did not change?
2. Puzzles 4 and 5 are mirror images. State the rule for `r` and `x` on a directory in one sentence each.
3. In puzzle 6, eve could not read the file but could delete it. Which permission allowed that, and on what?

**Clean up** when you finish:

```bash
cd ~ && sudo rm -rf /srv/lab && sudo userdel -r eve && sudo groupdel wallet
```

## Part D · Wallet v0 as a plain process (45 min)

Wallet v0 is about 25 lines of Python that answer balance questions over HTTP; it is deliberately simple so you can see everything Linux does around it.

Create `~/cn-lab/wallet/wallet.py` and type it in:

```python
#!/usr/bin/env python3
"""wallet v0: one process, balances kept in a JSON file."""
import json, os, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

DATA = os.environ.get("WALLET_DATA", "balances.json")
PORT = int(os.environ.get("WALLET_PORT", "8080"))

def load():
    with open(DATA) as f:
        return json.load(f)

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        account = self.path.strip("/")
        balances = load()
        if account not in balances:
            self.send_error(404, "no such account")
            return
        body = json.dumps({"account": account, "balance": balances[account]})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body.encode() + b"\n")

print(f"wallet v0 pid={os.getpid()} port={PORT} data={DATA}", file=sys.stderr, flush=True)
HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
```

In **terminal 1**, make it executable and start it:

```bash
cd ~/cn-lab/wallet
echo '{"alice": 100, "bob": 50}' > balances.json
chmod +x wallet.py
./wallet.py
```

It prints one line such as `wallet v0 pid=13042 port=8080 data=balances.json` and keeps running. In **terminal 2**:

```bash
curl localhost:8080/alice          # {"account": "alice", "balance": 100}
curl -i localhost:8080/carol       # HTTP/1.0 404 no such account
PID=$(pgrep -f 'python3 ./wallet.py'); echo $PID
ls -l /proc/$PID/fd                # its open files
readlink /proc/$PID/cwd            # its working directory
tr '\0' ' ' < /proc/$PID/cmdline; echo
```

Each request also prints an access-log line in terminal 1, such as `"GET /carol HTTP/1.1" 404 -`.

1. Which file descriptors does the wallet have open, and what does each point to? Which one is the network socket?
2. The access log appears in terminal 1. Which stream is it written to? Prove it: stop the wallet with `Ctrl+C`, restart it with `./wallet.py 2> wallet.log`, send a request, and look at both the terminal and `wallet.log`.
3. Why does the `chmod +x` step matter? What happens if you skip it and type `./wallet.py`?
4. The `#!/usr/bin/env python3` first line is called a *shebang*. What does the kernel do with it?

**Careful with `pgrep -f`.** It matches against whole command lines. If you put `pgrep -f wallet.py` inside a script whose own command line contains `wallet.py`, it finds the script too, and a following `kill` stops the wrong process. Match as precisely as you can.

## Checkpoint

You are done when all of these hold. Commit `~/cn-lab/lab-1.1.md` and `~/cn-lab/wallet/`.

| Check | Expected |
| --- | --- |
| `curl -s localhost:8080/alice` | `{"account": "alice", "balance": 100}` |
| `curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/carol` | `404` |
| `ls -l /proc/$PID/fd` | run in the terminal where you set PID: at least four entries, one of them `socket:[...]` |
| Notebook | predictions and results for all six permission puzzles, and the challenge pipeline |

## Break it

With the wallet running, take away its right to read its own data:

```bash
chmod 000 ~/cn-lab/wallet/balances.json
curl -sS localhost:8080/alice
```

`curl` reports `curl: (52) Empty reply from server`. Now look at terminal 1: there is a Python traceback.

1. Read the traceback from the bottom up. Which line of `wallet.py` failed, and what is the exact error?
2. The wallet process is still running, yet the client got no answer. Is this good or bad behaviour for a payment service? What should the client have received instead?
3. Restore the file with `chmod 644` and confirm `curl` works again without restarting the wallet. Why did no restart help or matter here?

This is the most common real-world failure pattern you will debug in this book: the symptom shows up in one place (the client), the cause is printed somewhere else (the server's stderr), and the root cause is a permission one layer down.
