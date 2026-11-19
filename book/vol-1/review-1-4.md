# Review 1.4

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** What does `apt` do that `dpkg` does not, and which of the two would you use to find out which package installed `/usr/bin/ss`?
2. **Concept.** In SSH, which key proves *you* to the server and which key proves *the server* to you? Where is each one stored on each side?
3. **Concept.** Using Gregg's definitions, explain the difference between utilization and saturation with one example from Lab 1.4. Why does the USE method check saturation and errors before utilization?
4. **Trace.** Walk through `fragile.sh` line by line, first without and then with `set -euo pipefail`. For each line say what runs, what it prints, and the final exit status.
5. **Debug.** `uptime` shows a load average of 18 on a 4-core server, but `top` shows the CPUs 85 percent idle. Name the two columns of `vmstat 1` you read next and the tool you run after that to find the culprit.
6. **Debug.** After a colleague rebuilds a server, `ssh` stops with `REMOTE HOST IDENTIFICATION HAS CHANGED`. Another colleague suggests `StrictHostKeyChecking no`. What do you do instead, and why?
7. **Design.** Write the first five lines of a nightly backup script that must never delete files outside `$BACKUP_DIR`, must fail loudly when the wallet is not answering, and must always remove its temporary directory.
8. **Design.** Your monitoring system scrapes every 60 seconds. Which two of the four Lab 1.4 faults would it most likely miss, and what would you change so it catches them?

**Read the diagram.** In the USE method decision flow, the CPU check reaches the "Saturated?" diamond with the answer *yes*. Which box do you land in, which command from the checklist table got you there, and what is your *next* command? Then trace the wallet's Break it case (every resource idle) through the same diagram: where does each of the four resources end up, and what does the diagram tell you to do once all four are exonerated?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Part 1: one tool knows about repositories, the other about the files on this machine. |
| 2 | The SSH diagram has one key file on each side, plus one record file on each side. |
| 3 | The checkout counter. Which of the three is easiest to read without knowing the normal level? |
| 4 | The before/after diagram in part 3, and the table of the three settings. |
| 5 | Tasks waiting for a disk count towards load on Linux (Ch 1.2). |
| 6 | Part 2, "The server's key", and the matching row of the In production table. |
| 7 | The habits table: `${VAR:?}`, `mktemp -d`, `trap ... EXIT`, and `\|\| { ...; exit 1; }`. |
| 8 | Look at how long each fault lasted in the Lab 1.4 chart, and at the last paragraph of part 5. |
