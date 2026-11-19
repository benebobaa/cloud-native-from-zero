# Review 1.5

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** A container is not a small virtual machine. Name the kernel mechanism that answers each question about a process: what can it see, how much can it use, what may it do, which files are `/`. Which of these four does a virtual machine replace with a separate kernel?
2. **Concept.** `unshare --user --map-root-user` makes you root without `sudo`. Using `uid_map`, explain why you still cannot write `/etc` on the host, and what a `CapEff` of `000001ffffffffff` means inside that namespace.
3. **Concept.** Why is `chroot` not a security boundary, and which mistake behind CVE-2024-21626 is the same? What do `pivot_root` and unmounting the old root change?
4. **Trace.** `mini.sh` runs `unshare`, then `hostname`, then several `mount` commands, then `pivot_root`, then `umount -l`, then `exec`. For each step say which namespaces already exist, what the process can see of the host, and what it cannot yet change.
5. **Trace.** A Pod has `resources.limits.memory: 256Mi` and `resources.limits.cpu: 500m`. Write the two cgroup files and the exact values the runtime writes for them, then say what the container experiences when it exceeds each limit.
6. **Debug.** A Pod shows `OOMKilled` while `free -m` on its node reports 10 GB available. A colleague proposes adding RAM to the node. Which three files of the container's cgroup do you read, what do you expect in them, and what do you change instead?
7. **Debug.** After a CPU limit of `500m` is added, a service's p99 latency doubles while its average CPU stays at 40 percent. Which two counters in which file prove the cause, and what are two possible fixes?
8. **Design.** A service converts PDFs uploaded by strangers. Using only the mechanisms of this chapter, list five settings (systemd or Kubernetes names) that limit the damage of a bug in the converter, say what each one protects, and name one threat they do not cover.

**Read the diagram.** In "Every unit gets its own cgroup directory" (part 4), find the three leaf cgroups. Which two have a `pids.max`, and what is its value? Which leaf shows `oom_kill 1`, and in which file would you read that? If you wrote `100M` into the `memory.max` of `app.slice`, which leaves would the new limit cover, and what would happen to `wallet.service` if it used 120 MiB? Then, in "One kernel gives each process the view of its own namespaces", a colleague reads the User row and says the container's root can edit the host's `/etc/passwd`. Which row of the host column and which row of the container column do you point to when you answer, and which file in `/proc` would you show them?

## Hints

| Q | Hint |
| --- | --- |
| 1 | The table in part 1 of the theory: problem, mechanism, question it answers. |
| 2 | `cat /proc/self/uid_map` in Lab 1.5 Part A: three numbers, inside ID, outside ID, length. |
| 3 | Part 3, with the picture of `chroot` and `pivot_root` side by side. Think of the working directory. |
| 4 | Lab 1.5 Part B, step 4: the comments in `mini.sh`. Which line creates which namespace, and when is `/` replaced? |
| 5 | Part 4: the file table. A byte count for memory, and a quota and a period for CPU. One of them kills, the other waits. |
| 6 | Lab 1.5 Part C and the first row of the In production table. Not `free -m`. |
| 7 | The CPU paragraph of part 4, and the Part C step 6 output. Compare two numbers in `cpu.stat`. |
| 8 | Parts 2 and 5, and the hardened `wallet.service` in the Milestone. Remember what all containers share. |
| Diagram | The cgroup tree: a limit on a parent covers everything below it. The namespace picture: the User row and the Mount row, then `/proc/<pid>/ns/user`. |
