# Review 4.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** List the six things the wallet's Compose file asks for (network, storage, limits, health, restart, least privilege) and name the Linux feature behind each. Which of the six is not a kernel feature, and who does that work instead?
2. **Concept.** What is the difference between a container that is running, one that is healthy and one that was restarted? What does Docker do when a health check fails three times in a row?
3. **Concept.** A memory limit ends in a kill and a CPU limit ends in a slowdown. Explain why, and name the cgroup file you would read to see each effect.
4. **Trace.** You run `curl 127.0.0.1:18080/accounts/alice` on your machine. Follow the request to the row in Postgres and back. Name every network, port, container and name lookup on the way.
5. **Trace.** You run `docker compose up -d` on an empty machine. Give the order in which Postgres, the API and the worker start, say at which moment each of them starts, and say which setting enforces that order.
6. **Debug.** The API container is `Up`, Postgres is `healthy`, yet every request to the API returns `database unavailable`. Name two causes and, for each, the first command you would run.
7. **Debug.** A container restarts every few seconds and `docker inspect` shows exit status 137. Give two possible causes and the single field that tells them apart.
8. **Design.** You add a `reporting` service that reads from Postgres, peaks at 300 MiB, must be reachable only from your own machine, must not write to its root filesystem and must not reach the internet. List its network, port, memory and CPU, security and health settings, and say what you would measure to choose the memory number.

**Read the diagram.** In the diagram "Docker marks an unhealthy container but never restarts it; only an exit does that" (Ch 4.3, part 4), Postgres is stopped for a minute. Which state does the API reach, and what does Docker do about it? What would happen instead if the API process itself crashed with exit status 1?

## Hints

| Q | Hint |
| --- | --- |
| 1 | The at-a-glance table at the top of Ch 4.3 has one row per setting, with the kernel feature in the last column. One of the six is only a daemon. |
| 2 | Reread the Dockerfile reference quotation in part 4 and the measured line under the state diagram. |
| 3 | Use the two lanes of the limits diagram in part 3, and the files `memory.max`, `cpu.max` and `cpu.stat`. |
| 4 | Use the network diagram in part 1: there are two networks and one published port. Where does the name `postgres` get resolved? |
| 5 | The start-order panel of the part 4 diagram. Which condition of `depends_on` is used? |
| 6 | Compare Break it, part 2, with a wrong network or a wrong host name. What does `pg_isready` not check? |
| 7 | Lab 4.3 Part D step 1 and Break it part 1: one field says whether the kernel's OOM killer acted. |
| 8 | Combine the three least-privilege settings, an `internal` network and a published port bound to `127.0.0.1`; size the memory from a measurement under load, as in Part D. |
| Diagram | Follow the arrows out of `unhealthy`. Then ask which transition a crash would use, and what a restart policy reacts to. |
