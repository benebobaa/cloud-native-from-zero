# Review 5.5

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** `kubeadm init` does not start the control plane itself. What does it write, where, and which program then starts the API server? Why can the control plane come up before any API server exists?
2. **Concept.** A kubeadm cluster has three certificate authorities and eleven leaf certificates that last 1 year. Name the three CAs. Why does a cluster that is upgraded every six months never hit an expiry, and why is `kubelet.conf` missing from the `check-expiration` list?
3. **Trace.** A Pod is assigned to a node that runs CRI-O. List the calls in order from the kubelet to the running container: which component talks to which, and over what kind of connection. Which command shows the result below the API, and which kubelet setting names the runtime socket?
4. **Trace.** You take an etcd snapshot at 02:00. At 09:00 someone deletes the ConfigMap `rates` and creates the ConfigMap `promo`. At 09:10 you restore the 02:00 snapshot and switch etcd to the restored directory. Which of the two ConfigMaps exist afterwards? List the four steps of the restore in order and say which one changes nothing on the running cluster.
5. **Debug.** `kubectl get nodes` prints `connection refused`, yet customers still reach the wallet. Give the first four checks you run on the control-plane node, in order, and what each result would tell you.
6. **Debug.** `kubectl drain node-2 --ignore-daemonsets` prints `Cannot evict pod as it would violate the pod's disruption budget` every 5 seconds and never ends. Give two different causes and the change that fixes each one without losing availability.
7. **Design.** Design the etcd backup for a production cluster with three control-plane nodes. Cover what you back up, how often, where the files go, how you know a backup is good, and two things a snapshot does not contain.
8. **Design.** 50 worker nodes need a kernel patch, and the wallet must not go down. The Postgres Pod uses node-local storage on one of them. Write the plan: order, batch size, what you check between nodes, and what is different for the Postgres node.

{{diagram review-5-5-01.jsx | etcd quorum lost · 2 of 3 control-plane members gone}}

**Read the diagram.** In the diagram above, answer three things. (a) Can an engineer run `kubectl create deployment` through the API server on control-plane-3? Why? (b) Are the wallet Pods on the workers still running, and what can nobody do to them? (c) The last snapshot is 5 hours old. Write the recovery in order, and say what it loses.

## Hints

| Q | Hint |
| --- | --- |
| 1 | Look at the kubeadm phases diagram: five phases only write files. Find `staticPodPath`. |
| 2 | The certificate tree diagram, the rule "Upgrades renew", and the last paragraph of that section. |
| 3 | The CRI layers diagram, then Lab 5.5 Part A (`crictl`) and Part D (the runtime swap). |
| 4 | The etcd snapshot and restore diagram, and the four numbered steps under it. |
| 5 | Lab 5.5 Break it, and Lab 5.1 Break it: Pods keep running without the API server. |
| 6 | The drain flow diagram and the PDB bullet. In Lab 5.5 Part C compare `minAvailable` with the replica count and read `ALLOWED DISRUPTIONS`. |
| 7 | The "Rules for a real restore" list. Think about volumes and `/etc/kubernetes`. |
| 8 | Cordon, drain, uncordon per batch. Re-read the measured Postgres drain in the theory, and `unhealthyPodEvictionPolicy`. |
| Diagram | A majority of 3 is 2. Ask what a write needs, and what a kubelet needs. |
