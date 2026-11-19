# Glossary & References

## Glossary

Terms in the order you meet them; the last column is the chapter that defines each.

| Term | Meaning | Ch |
| --- | --- | --- |
| Distributed system | Computers that cooperate only by sending messages, so that the user sees one service | 3.1 |
| Fallacies of distributed computing | Eight false assumptions about networks, from "the network is reliable" to "the network is homogeneous" | 3.1 |
| Timeout | A guess that "no reply by now" means failure; the only failure detector there is | 3.1 |
| Idempotent | Safe to repeat: doing it twice has the same effect as doing it once (the wallet's transfer `id`) | 3.1 |
| Failure model | A promise about how components may misbehave: crash-stop, crash-recovery, omission, timing or Byzantine | 3.1 |
| Crash-stop / crash-recovery | A machine that stops for good / one that stops and may restart with its disk but not its memory | 3.1 |
| Omission failure | A component that drops some messages it sends or receives (a lossy link, a partition) | 3.1 |
| Timing failure | A component that answers correctly but too late | 3.1 |
| Byzantine failure | A component that may do anything, including lie; tolerating f of them needs at least 3f + 1 machines | 3.1 |
| Safety and liveness | Safety: nothing wrong ever happens, even when clocks and networks misbehave. Liveness: something good eventually happens, which may need them to behave | 3.1 |
| Wall clock / monotonic clock | The date, which can jump when corrected / a counter that only moves forward, for durations on one machine | 3.1 |
| Happened before, concurrent | Lamport's partial order from messages; two events with no message chain between them are concurrent | 3.1 |
| Lamport clock, vector clock | A counter per process that respects happened-before / one counter per process, which can also detect concurrency | 3.1 |
| Partition (network) | The network splits so that nodes on different sides cannot reach each other | 3.1 |
| CAP theorem | In an asynchronous network with lost messages, a read/write object cannot be both available and linearizable (Gilbert and Lynch) | 3.1 |
| Linearizable | Every operation looks as if it took effect at one instant between its start and end; a read after a finished write sees it | 3.1 |
| Causal / eventual consistency | If a happened before b, everyone sees a first / if updates stop, all replicas eventually return the last value | 3.1 |
| PACELC | Abadi's extension of CAP: if Partition, trade Availability against Consistency; Else, trade Latency against Consistency | 3.1 |
| Replicated state machine | Identical deterministic programs fed the same log of commands in the same order, so they end in the same state | 3.2 |
| Log, log entry | An ordered list of commands; each entry has an index, a term and a command | 3.2 |
| Consensus | Agreement of several servers on the contents and order of the log while some of them fail | 3.2 |
| Majority (quorum) | More than half of n servers, n/2 + 1 rounded down; any two majorities of one group share a server | 3.2 |
| Raft | The consensus algorithm of Ongaro and Ousterhout; one leader at a time, replicated log, majorities | 3.2 |
| Leader, follower, candidate | The three Raft server states: accepts writes, answers the leader, asks for votes | 3.2 |
| Term | A number that counts periods of leadership; a logical clock that only grows and travels in every message | 3.2 |
| Heartbeat, election timeout | The leader's regular message / how long a follower waits without one before starting an election; drawn at random from T to 2T in etcd | 3.2 |
| Split vote | An election in which no candidate gets a majority; a new one starts in a higher term | 3.2 |
| AppendEntries | The message that copies log entries to a follower; with no entries it is the heartbeat | 3.2 |
| Commit | An entry is committed once the leader that created it has copied it to a majority; then it is applied in log order | 3.2 |
| CheckQuorum, Pre-Vote | Guards etcd adds to Raft: a leader steps down if it hears from no majority; a returning member does not disrupt the cluster | 3.2 |
| Snapshot | One consistent file of the whole etcd database; the standard backup | 3.2 |
| etcd | The strongly consistent key-value store, built on Raft, behind the Kubernetes API server | 3.2 |
| Revision | etcd's cluster-wide change counter; each key keeps create\_revision, mod\_revision and version; Kubernetes' resourceVersion | 3.2 |
| Watch | A stream of changes after a chosen revision: etcd replays history, then sends new events | 3.2 |
| Transaction (compare-and-swap) | "If these conditions hold, do A, else do B", atomically; the base of optimistic concurrency | 3.2 |
| Lease | A key tied to a time limit that vanishes unless its holder renews it; the base of leader election | 3.2 |
| Linearizable and serializable read | A read confirmed by a majority, always current / a read answered by one member, faster, possibly stale | 3.2 |
| Desired state, actual state | What you wrote down you want (spec) / what exists now (status) | 3.3 |
| Imperative, declarative | Instructions that name actions / a record of the goal that can be applied any number of times | 3.3 |
| Control loop, controller | A non-terminating loop that regulates a system toward a goal / the program that runs one | 3.3 |
| Reconcile | One pass of the loop: read the goal, observe the world, act on the difference | 3.3 |
| Level-triggered, edge-triggered | Acts on the current state / acts on a change event and breaks when one is lost | 3.3 |
| Label | A `key=value` tag on an object; a controller touches only what carries its label | 3.3 |
| Leader election | Letting only one copy of a controller act at a time, usually with a lease | 3.3 |
| Static stability | The system keeps working when a dependency becomes impaired; what runs keeps running | 3.3 |
| Backoff and jitter | Waiting longer after each failure and adding randomness, so that retries do not arrive together | 3.3 |
| Fencing token | An ever-increasing number from a lock service; storage rejects writes that carry an older one | 3.1 |

## References

Every source below is cited in this volume. On 2026-11-17 every link returned HTTP 200 from the test machine, except the FLP paper at groups.csail.mit.edu, whose host that network could not resolve (unverified from here; the paper is also at the ACM Digital Library).

| Source | Used for | Ch |
| --- | --- | --- |
| [Lamport, A distributed system is one in which...](https://lamport.azurewebsites.net/pubs/distributed-system.txt) | The 1987 definition of a distributed system | 3.1 |
| [Fallacies of distributed computing](https://en.wikipedia.org/wiki/Fallacies_of_distributed_computing) | Deutsch and Gosling's eight fallacies, with history | 3.1 |
| [Lamport, Shostak, Pease: The Byzantine Generals Problem](https://lamport.azurewebsites.net/pubs/byz.pdf) | The 3m + 1 bound | 3.1 |
| [Fischer, Lynch, Paterson: Impossibility of Distributed Consensus with One Faulty Process](https://groups.csail.mit.edu/tds/papers/Lynch/jacm85.pdf) | Why timeouts are guesses | 3.1 |
| [Lamport: Time, Clocks, and the Ordering of Events](https://lamport.azurewebsites.net/pubs/time-clocks.pdf) | Happened-before, Lamport clocks | 3.1 |
| [Brewer: PODC 2000 keynote](https://people.eecs.berkeley.edu/~brewer/cs262b-2004/PODC-keynote.pdf) and [Gilbert and Lynch: Brewer's Conjecture](https://www.comp.nus.edu.sg/~gilbert/pubs/BrewersConjecture-SigAct.pdf) | The CAP conjecture and its proof | 3.1 |
| [Abadi: Consistency Tradeoffs in Modern Distributed Database System Design](https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf) | PACELC | 3.1 |
| [Kleppmann: A Critique of the CAP Theorem](https://arxiv.org/abs/1509.05393) | Limits of the CAP labels | 3.1 |
| [DeCandia et al.: Dynamo](https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf) and [Vogels: Eventually Consistent](https://www.allthingsdistributed.com/2008/12/eventually_consistent.html) | Vector clocks, eventual consistency | 3.1 |
| [Jepsen: etcd 3.4.3](https://jepsen.io/analyses/etcd-3.4.3) and [Kleppmann: How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html) | Why timing-based locks are unsafe; fencing tokens | 3.1, 3.2 |
| [GitHub: October 21 post-incident analysis](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) and [Cloudflare: the leap second](https://blog.cloudflare.com/how-and-why-the-leap-second-affected-cloudflare-dns/) | Two real incidents | 3.1 |
| [Ongaro and Ousterhout: In Search of an Understandable Consensus Algorithm](https://raft.github.io/raft.pdf) | Raft: elections, log replication, safety | 3.2 |
| [etcd FAQ](https://etcd.io/docs/latest/faq/), [API guarantees](https://etcd.io/docs/latest/learning/api_guarantees/), [tuning](https://etcd.io/docs/latest/tuning/), [maintenance](https://etcd.io/docs/latest/op-guide/maintenance/) | Cluster sizes, read guarantees, timer rules, backups | 3.2 |
| [Kubernetes: Operating etcd clusters](https://kubernetes.io/docs/tasks/administer-cluster/configure-upgrade-etcd/) and [cluster architecture](https://kubernetes.io/docs/concepts/architecture/) | etcd's role in Kubernetes | 3.2 |
| [CNCF: etcd](https://www.cncf.io/projects/etcd/) | Maturity (Graduated), checked 2026-11-16 | 3.2 |
| [Kubernetes: Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) and [Writing Controllers](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/controllers.md) | Control loops, level-driven design, leader election | 3.3 |
| [Kubernetes: kube-controller-manager reference](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-controller-manager/) | Leader-election defaults (15 s lease, 10 s renew deadline, 2 s retry), node-monitor grace period (50 s) | 3.1, 3.3 |
| [Burns et al.: Borg, Omega, and Kubernetes](https://research.google.com/pubs/archive/44843.pdf) and [Verma et al.: Large-scale cluster management at Google with Borg](https://research.google.com/pubs/archive/43438.pdf) | Reconciliation, choreography, running tasks keep running | 3.3 |
| [The Twelve-Factor App](https://12factor.net/) | Stateless, disposable processes | 3.3 |
| [AWS Builders' Library: Static stability](https://aws.amazon.com/builders-library/static-stability-using-availability-zones/) | Static stability | 3.3 |

## Versions tested

All lab commands in this volume were run on 2026-11-16 and 2026-11-17 on an Ubuntu 26.04 host in WSL2 with Docker Desktop (Docker Engine 29.9.2), using `quay.io/coreos/etcd:v3.7.3`, `postgres:17`, `wallet:v1` and `alpine:3.21` with iproute2 and nftables; the lab scripts ran on Python 3.14.4. Not run: Ubuntu 24.04 with Docker Engine from apt, and Python 3.12 on the host. Lab 3.3's timings came from a busy shared laptop (load average 18 to 24); expect the same patterns, not the same digits. The measured data files are kept in the course repository under `reference/` (`vol3-*.csv`).
