# Review 7.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** A colleague says "a CRD is just a ConfigMap with a fancier name". Give three things a CRD with a schema gives you that a ConfigMap does not.
2. **Concept.** Explain *level-triggered* and *edge-triggered* controllers in four sentences. Why must a Kubernetes controller be level-driven? Use an outage of the controller as your example.
3. **Concept.** A platform team gets the request "every team needs its own database". Compare three answers: a Helm chart, a hand-written operator, and Crossplane. For each, say what stays continuously reconciled and what does not, and name one cost.
4. **Trace.** `WalletAccount carol` has a finalizer, and its operator is running. Write the steps, in order, from `kubectl delete walletaccount carol` until the object is gone. State what the API server does and what the operator does at each step, and what `kubectl get walletaccount carol -o yaml` shows in the middle.
5. **Trace.** A ScaledObject has `minReplicaCount: 1`, `maxReplicaCount: 5`, `cooldownPeriod: 30` and a trigger with `targetQueryValue: "2000"` (average-value target). The backlog is 900, then 4,100, then 12,000, then 0. How many replicas does the HPA ask for each time? What do you expect the replica count to be 60 seconds after the backlog reaches 0, and why?
6. **Debug.** Your operator creates the wallet account, but the `WalletAccount` never shows a `Ready` column. The log says `403 Forbidden: walletaccounts.cnlab.example.com "carol" is forbidden ... cannot patch resource "walletaccounts/status"`. Explain the cause and give the exact fix and a command that proves it.
7. **Debug.** The operator Pod uses a full CPU core. The API server shows hundreds of `PATCH` requests per second on one `WalletAccount`. Each reconcile writes `status.checkedAt` with the current time. Explain the loop and give two fixes.
8. **Design.** Product asks that creating a `WalletAccount` also opens a record in a second service, and that deleting it closes both. Design the operator: which fields go in `spec` and `status`, when it adds the finalizer, how each step stays idempotent, and what happens if the second call fails halfway or the operator restarts in the middle.

**Read the diagram.** In the KEDA diagram in Ch 7.3, follow the number "pending transfers" from Postgres to a replica count. Name every component it passes through, in order. Then say which arrows exist only because of KEDA, and why `keda-operator` is the only box with arrows to both the HPA and the Deployment.

## Hints

| Q | Hint |
| --- | --- |
| 1 | Look at the table of CRD parts: schema, status subresource, printer columns, API path. Think about RBAC and `kubectl explain` too. |
| 2 | Re-read the level-versus-edge diagram: what does the controller do when it restarts? |
| 3 | Ask which of the three keeps running after the first install, and which needs a person to run it again. |
| 4 | Use the finalizer diagram. Which field marks the object as being deleted? Who removes the key? |
| 5 | The HPA rule divides the metric by the target. Then check which setting controls going from 5 to 1. |
| 6 | The status subresource is its own endpoint with its own RBAC resource name. |
| 7 | A write to the object you watch is an event. What in the written value changes every time? |
| 8 | Three states: creating, deleting, failing halfway. Write what is true in `status` at each. |
| Read the diagram | Trace the arrows from left to right in the lower row, then look for the arrows leaving `keda-operator`. |
