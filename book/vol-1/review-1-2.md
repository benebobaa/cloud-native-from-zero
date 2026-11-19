# Review 1.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Why can a program not read a disk directly? What would go wrong on a shared machine if it could?
2. **Concept.** Explain `fork` and `exec` to a classmate in four sentences. Why does Unix use two calls instead of one?
3. **Concept.** What is the difference between `VSZ` and `RSS`? Which one should you compare with a container's memory limit?
4. **Trace.** A container exits with code `143`. Another exits with `137`. For each, say which signal ended it and give one likely cause.
5. **Trace.** `top` shows load average `8.0` on a 4-core machine, but CPU usage is only 20%. Which process state explains this, and what resource would you check next?
6. **Debug.** A Pod always takes exactly 30 seconds to terminate. Using this chapter, explain the most likely cause and two different fixes.
7. **Debug.** `free -h` on a database server shows only 200 MB `free` out of 16 GB, and a colleague wants to add RAM. What do you check first, and why?
8. **Design.** The wallet will soon move money. Describe what it must do between receiving `SIGTERM` and exiting, so that no transfer is lost or done twice.

**Read the chart.** In the OOM chart in Lab 1.2 Part D, memory rose by about 1 MB every 60 ms from about 10 MB. If the limit had been 200 MB, roughly when would the kill have happened? What would change in the picture, and what would stay the same?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the system-call boundary diagram; think about permissions and other users' files. |
| 2 | Look at the lifecycle diagram, then the paragraph on what bash does between the two calls. |
| 3 | The OOM killer counts memory that is actually in RAM. |
| 4 | 128 + N. |
| 5 | Two states count towards load average. |
| 6 | See "Why PID 1 is special" and the Break it of Lab 1.2. |
| 7 | Look at the page cache paragraph and the `available` column. |
| 8 | Three steps: stop accepting, finish or roll back, exit. Where does a half-finished transfer live? |
