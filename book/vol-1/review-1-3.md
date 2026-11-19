# Review 1.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** What does an inode store, and what does it not store? Where does a file's name live?
2. **Concept.** Give one situation where you would use a hard link and one where only a symbolic link works.
3. **Concept.** In OverlayFS, what happens when a container (a) reads, (b) edits and (c) deletes a file that exists only in the lower layer?
4. **Trace.** List the stages from pressing the power button to the wallet service running, naming what each stage hands to the next.
5. **Debug.** A server reports `No space left on device` but `df -h` shows 40% free. What do you check next, and what is the likely cause?
6. **Debug.** A unit is in state `failed` with `Start request repeated too quickly`. What happened, and what is your first command?
7. **Design.** A team stores uploaded receipts inside the wallet container's own filesystem. Explain two ways this will hurt them, using this chapter.
8. **Design.** You need the wallet backup to run at 02:00 every night, even if the laptop was asleep then. Choose cron or a systemd timer and write the key line.

**Read the diagram.** In the OverlayFS diagram, the container now creates a new `base.txt` after deleting the old one. Which cells of the diagram change, what happens to the whiteout, and does the lower layer change?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Look at the Links table and the sentence before it. |
| 2 | One survives deletion of the original; the other can cross filesystems. |
| 3 | Three rules in part 2: read, copy-up, whiteout. |
| 4 | Five boxes in the boot diagram, plus the unit file. |
| 5 | A filesystem can run out of two things. |
| 6 | Look at "Crash loops" in part 3, and remember where service output goes. |
| 7 | Copy-up cost, and what happens to the upper layer when the container is replaced. |
| 8 | Which option lets a timer catch up a missed run? |
