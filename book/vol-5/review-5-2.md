# Review 5.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** The wallet has an API, a worker, Postgres, a nightly audit and a log shipper that must run on every node. Name the workload object you would use for each, and the one promise from the chapter that decides it. Then say what can go wrong if Postgres runs as a Deployment of 2 replicas.
2. **Concept.** Which field records who owns a Pod, and which two sub-fields tell you that the owner is the one that manages it? What does `kubectl delete deploy web --cascade=orphan` leave behind, and how can a new Deployment take it over without restarting a Pod?
3. **Trace.** A Deployment has 10 replicas and the default strategy. Using the rounding rules, work out the largest number of Pods that may exist and the smallest number that must be available during the rollout. Then take 4 replicas with `maxSurge: 0` and `maxUnavailable: 1`, and describe the first two steps of the rollout.
4. **Trace.** A Deployment of 4 replicas uses `maxSurge: 1` and `maxUnavailable: 0`. You run `kubectl set image` with a tag that does not exist. Describe what `kubectl get pods` and `kubectl get deploy` show, what happens after 10 minutes, and what you type to recover.
5. **Debug.** In Lab 5.2 Part D the flaky Pod's liveness probe first failed at about 22 s, yet its new container was created at about 58 s. Account for the gap: name the events and the process involved, and give two different fixes.
6. **Debug.** Every wallet-api Pod restarts, one after another, each time the Postgres Pod restarts, and the restart counts keep growing. Which line of the Deployment is the likely mistake, why does it make things worse, and what should replace it?
7. **Debug.** One Pod shows `OOMKilled` with exit code 137 and a growing `RESTARTS` count. Another Pod, on a different node, is gone and its message says "The node was low on resource: memory". For each one, say what ended it, what number it was compared with, and who creates the replacement.
8. **Design.** Write the rollout and probe settings for a wallet-api Deployment of 6 replicas that needs 20 s to start, must never serve with fewer than 5 Pods, stops cleanly within 3 s of SIGTERM, and sometimes loses its database for a minute. Give the strategy, the three probes (path and purpose), `terminationGracePeriodSeconds`, and a PodDisruptionBudget.

**Read the diagram.** The picture shows the wallet API as `kubectl` sees it. Pod D was relabelled by hand, and Pod C has a failing readiness probe.

{{diagram review-5-2-01.jsx | Review 5.2 · read the diagram · 1 Deployment, 1 ReplicaSet, 4 Pods, 1 Service}}

(a) How many Pods does the ReplicaSet count as its own, and what will it do next? (b) Which Pods can receive traffic from the Service, and why not the others? (c) You run `kubectl delete deploy wallet-api` with no flags. Which Pods are left, and why? (d) What single command removes the leftover Pod?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the table of workload shapes. Ask of each program: how many copies, named how, where, and does it ever stop? |
| 2 | Look at the `ownerReferences` output in the chapter and at the orphan lane of the ownership diagram. The adopter needs the same selector and the same Pod template. |
| 3 | `maxSurge` rounds up, `maxUnavailable` rounds down. Replicas plus surge is the ceiling; replicas minus unavailable is the floor. With surge 0 something must go first. |
| 4 | The new ReplicaSet is stopped by `maxUnavailable: 0`. Read the `UP-TO-DATE` and `AVAILABLE` columns of the chapter's bad-image output, then the paragraph about `progressDeadlineSeconds`. |
| 5 | Count how many liveness failures the probe needs, then look at the PID 1 paragraph and at the `Killing` and `Created` events in the timeline. |
| 6 | Which probe may depend on the database, and which may not? See the table of three probes and Part D of the lab. |
| 7 | One is a container limit enforced by the kernel, the other is a node threshold enforced by the kubelet. See the In production table and Ch 1.2. |
| 8 | Combine the maxSurge and maxUnavailable rules, the startup probe row of the In production table, the termination sequence and the PDB paragraph in Going deeper. |
| Diagram | A ReplicaSet counts Pods by selector, not by READY. A Service uses its own selector and only sends traffic to Ready Pods. Ownership is a field, not a label. |
