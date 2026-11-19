# Review 5.4

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** A claim asks for `300Mi` and binds a `500Mi` PV. Which three properties must match for a PV to be a candidate, which controller does the matching, and which two fields record the binding?
2. **Concept.** Say in one sentence each what a PersistentVolume, a PersistentVolumeClaim and a StorageClass are, and who normally writes each. Why does Kubernetes use three objects where a Docker volume uses one name?
3. **Concept.** What does `volumeBindingMode: WaitForFirstConsumer` wait for? Describe one storage setup where `Immediate` would produce a Pod that can never run, and say why.
4. **Trace.** In the 3-node lab you apply a PVC that names no class, and then, later, a Pod that uses it. After each step, say what `kubectl get pvc` shows, whether a PV exists, and which component acted.
5. **Trace.** Read this event clause by clause: `0/3 nodes are available: 1 node(s) had untolerated taint(s), 2 Insufficient cpu.` Which scheduler plugin wrote each clause? Why does a control-plane node appear in the first clause when nobody tainted anything?
6. **Debug.** After maintenance on its node, `postgres-0` stays `Pending` with `0/3 nodes are available: 1 node(s) didn't match PersistentVolume's node affinity, 1 node(s) had untolerated taint(s), 1 node(s) were unschedulable.` Which clause is about the data? Give two ways to get the Pod running again on this cluster and one design change that prevents the problem in production.
7. **Debug.** A teammate runs `kubectl delete pvc data-postgres-0` against the live database. The claim sits in `Terminating`, and later it disappears together with the data. Explain both observations and name two settings that would have kept the data.
8. **Design.** The wallet API runs 3 replicas on a 3-node cluster, Postgres needs the nodes labelled `disktype=ssd`, and application Pods must stay off the control plane. Write the scheduling rules you would add to each workload. For each rule say whether it is required or preferred, and what failure you accept by choosing that.

**Read the diagram.** The drawing below is an exercise, not a lab result. The three Pods arrive in the order shown, one at a time. For each Pod, say which nodes survive the Filter step and why each other node is rejected, then say where the Pod runs or what its `FailedScheduling` event would say. Finally, name the smallest change to one Pod that lets every Pod run, and say what it costs.

{{diagram review-5-4-01.jsx | exercise · 3 nodes, 3 Pods, Filter rules}}

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the three outcomes of the PV controller. A bound claim shows the PV's capacity, not its own request. |
| 2 | Use the table of objects: scope and who writes it. Think about who must know the storage system and who must not. |
| 3 | Compare steps 4 to 6 of the WaitForFirstConsumer diagram. What can a volume that exists before the Pod not know? |
| 4 | A claim can be `Pending` without being stuck. Read the events on the PVC, then the PV's `nodeAffinity`. |
| 5 | Filter versus Score. `NodeResourcesFit` writes the words starting with `Insufficient`; the control-plane taint is `node-role.kubernetes.io/control-plane`. |
| 6 | Three clauses, three nodes. One node holds the data. See Part 3 of the theory and what you did to the node in Lab 5.4 Break it. |
| 7 | Storage Object in Use protection, then the reclaim policy of a dynamically provisioned PV. The phase table lists the alternatives. |
| 8 | Required rules can leave Pods Pending; preferred rules cannot. The spread gotcha in Lab 5.4 Part C (C3) and the PV pin from Part B both apply. |
| Diagram | Apply the checks in order: taint, `nodeSelector`, free CPU (allocatable minus requested), then the volume's node affinity. Update the requested CPU after each Pod is placed. |
