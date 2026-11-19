# Review 1.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Give three reasons a text shell scales to a thousand servers better than a graphical interface.
2. **Concept.** What are file descriptors 0, 1 and 2? Why does an error message still appear on the screen when you pipe a command's output into `grep`?
3. **Concept.** A directory has mode `711`. What can other users do with it, and what can they not do?
4. **Trace.** You type `cat balances.json | grep alice > out.txt`. List, in order, what bash does: which programs it starts, and where each one's stdin, stdout and stderr point.
5. **Debug.** (Stretch: cron is taught in Ch 1.3.) A colleague's script deletes files from the wrong directory, but only when it runs from cron, never when they run it by hand. Name two shell-level causes you would check first.
6. **Debug.** `ssh -i key.pem server` fails with an error about the key's permissions. What does `ls -l key.pem` probably show, and what command fixes it?
7. **Design.** The wallet must read `balances.json`, and the backup job (user `backup`) must also read it. Nobody else may. Choose the owner, group and mode, and justify each choice.
8. **Design.** Wallet v0 crashed a request instead of answering when it could not read its data file. Describe what it should do instead, in terms a client program could act on.

**Read the diagram.** In the pipe diagram (part 1), the command becomes `ps aux 2>&1 | grep python`. Redraw it on paper: where does fd 2 of `ps` point now, and what changes on your screen?

## Hints

Use a hint only after ten honest minutes on the question.

| Q | Hint |
| --- | --- |
| 1 | Re-read the four bullets in "The problem". |
| 2 | Look at the bottom line of the pipe diagram. |
| 3 | Split it into owner, group, other, then use the directory column of the r/w/x table. |
| 4 | Two programs, one pipe, one file. `cat` reads its file itself; the shell does not open it for `cat`. |
| 5 | What is different about cron's environment? Think `PATH`, the starting directory, and unset variables. |
| 6 | OpenSSH refuses private keys that others can read. Which mode allows only the owner to read? |
| 7 | You need exactly two readers. Who should own the file, and what should the group contain? |
| 8 | The wallet speaks HTTP. Which family of status codes means "the server failed, try again later"? |
