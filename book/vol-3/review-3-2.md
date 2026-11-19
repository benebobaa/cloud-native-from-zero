# Review 3.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** What is a replicated state machine, and why does it suffice for the servers to agree on the log?
2. **Concept.** Why do any two majorities of the same group share a server? Name the two places where Raft relies on that fact.
3. **Concept.** What is a *term*, and why does a server that receives a message with a higher term at once become a follower?
4. **Trace.** A five-server cluster; the leader S1 (term 3) crashes. The election timers of S2 and S4 fire 20 ms apart, S2 first. S3 and S5 are healthy. Describe what happens in order. Can both S2 and S4 win? What if S4's vote request reaches S3 before S2's does?
5. **Trace.** Leader S1 (term 4) has log terms \[1, 1, 2, 4\]. Follower S2 has \[1, 1, 3\]. Walk through the `AppendEntries` exchange until S2's log matches S1's. What happens to S2's entry from term 3, and why is deleting it safe?
6. **Debug.** After a backup job starts on the same disks as etcd, the Kubernetes API server becomes slow and `etcd` logs show a new leader every minute or so. Explain the mechanism and give two fixes.
7. **Debug.** A three-member etcd has lost two members. `etcdctl put` fails, `etcdctl get` fails, but `etcdctl get --consistency=s` works on the survivor. Explain all three observations, and say what you would do first.
8. **Design.** A team proposes six etcd members, three in each of two data centres, "for symmetric protection". Evaluate it with quorum arithmetic: what does losing one whole data centre do? Propose a better layout and say what it tolerates.

**Read the diagram.** In the election-timeline diagram of this chapter, S3's timer is longer than S2's. (a) Why does S3 never become a candidate? (b) If S3's timer had been the shorter one, who would have become leader, and in which term? (c) Why can S2 win without any message from S1?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Same deterministic program, same inputs, same order gives the same state. |
| 2 | n/2 + 1 of n twice exceeds n. One use is committing an entry; the other is winning an election. |
| 3 | Think of a term as a logical clock for leadership; compare with the Lamport clock in Chapter 3.1. |
| 4 | Each server votes at most once per term. Count the votes S2 and S4 can each collect from S2, S3, S4, S5 and themselves. |
| 5 | The leader sends the entry before the new ones (index and term); the follower refuses on a mismatch and the leader steps back. Leader Completeness tells you whether the term-3 entry could have been committed. |
| 6 | Look at the etcd guide's statement about disk latency and `fsync`; what do late heartbeats make followers do? |
| 7 | Which requests need a majority? Which one does not? Compare with the CAP drawing. |
| 8 | Write the quorum size for six members, then count how many survive the loss of three. |
| Diagram | The timer restarts whenever a server receives a valid message from a leader or grants a vote. A candidate needs a majority of the whole cluster, not of the survivors. |
