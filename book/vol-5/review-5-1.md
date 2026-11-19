# Review 5.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion. Use the cluster from Lab 5.1 for the debug questions if you want to check your idea.

1. **Concept.** Name the four control-plane components and the three node components. Which one is the only component that talks to etcd, and why is it useful that there is only one?
2. **Concept.** A shell script starts containers on 50 machines; Kubernetes stores a desired state and runs loops. Explain with one example (a machine dies at 03:00) why the second design recovers and the first does not. Use the words *desired state*, *actual state* and *watch*.
3. **Trace.** You run `kubectl create deployment web --image=wallet:v1 --replicas=2`. List, in order, every component that acts until a container is running, and say what each one creates or changes. Which of them talk directly to each other?
4. **Trace.** `ConfigMap hello` is created when etcd's revision counter is at 939. Later, three other objects are written, then you patch `hello` once, and the counter reads 1003 after your patch. Give `CreateRevision`, `ModRevision`, `Version` and `metadata.resourceVersion` of `hello` at that moment. What would they be after a second patch?
5. **Debug.** Two Pods are both `Pending`. Pod A shows `NODE <none>` and `Events: <none>`. Pod B shows `NODE <none>` and a `FailedScheduling` event. Which component is not working in A, which one is working in B, and what do you check first for each?
6. **Debug.** `kubectl scale deploy web --replicas=4` prints `scaled`, yet `kubectl get deploy web` still says `2/4` ten minutes later and no new Pod exists. Name the missing component, give three commands that confirm it, and say what `kubectl get lease -n kube-system` would show.
7. **Debug.** `kubectl get pods` fails with `connection refused`, but the wallet answers `curl` requests on its Pod IP. What is down, what still works, and what can nobody do until it is back? Why do running Pods not need the part that is down?
8. **Design.** Your team wants a control plane that survives the loss of any two machines. How many etcd members do you need? Explain why four members would not be better than three, and what happens to `kubectl apply` when one more machine fails.

{{diagram review-5-1-01.jsx | web two minutes after create · read the objects and the events}}

**Read the diagram.** The drawing shows `web` two minutes after you created it. (a) Which loop has not done its job? (b) Name three details in the drawing that prove it and one detail that proves the other loops are healthy. (c) What would `kubectl describe pod` show in its `Events:` section, and why? (d) Give the command and the file path you would use on the control-plane node to bring it back.

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read "At a glance" and the two-halves diagram. Think about who may write to the database. |
| 2 | Reread "The problem", item 1. The script has no memory; where does Kubernetes keep it? |
| 3 | Use the chain diagram and the Events table. Each loop reacts to an object, not to another loop. |
| 4 | One counter for the whole store. `ModRevision` is the revision of the last write to that key; `Version` counts writes to that key only. |
| 5 | A scheduler that tries and fails leaves an event. A scheduler that does not run leaves nothing. |
| 6 | Break it, at the end of the lab: the API accepted the `spec`, but who acts on it? |
| 7 | "Control plane and data plane fail separately." Which component is the only door? |
| 8 | Majority = more than half. Fill in the table of members, majority and failures tolerated. |
| Diagram | Follow the ownership arrows left to right and stop at the first object whose owner should have acted. Compare the Events with the table of Events in the theory. |
