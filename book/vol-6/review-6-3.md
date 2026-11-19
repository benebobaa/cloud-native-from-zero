# Review 6.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Put these controls on the four lifecycle phases of the Ch 6.3 diagram: cosign, Pod Security Admission, Falco, a Harbor vulnerability scan. Which phase has no control from this chapter?
2. **Concept.** Why does a signature target an image *digest* and not a tag? Describe an attack that works against a tag but fails against a digest.
3. **Concept.** Name the two phases of admission control and the order they run in. Why must the mutating phase come first?
4. **Trace.** A `kubectl apply` of a Deployment with a privileged Pod template succeeds, yet no Pods appear. Trace what happened in a namespace labelled `pod-security.kubernetes.io/enforce: restricted` and give the command that shows the reason.
5. **Trace.** A Kyverno policy requires a valid cosign signature. A Pod references `registry/wallet:v1`. Trace what Kyverno does between the API request and the answer, naming what it reads from the registry and what it holds in the policy.
6. **Debug.** Kyverno is down and every `kubectl apply` in the cluster hangs for 10 seconds, then fails. Which setting of the webhook explains it, and what are two ways to avoid it next time?
7. **Debug.** `kubectl auth can-i list secrets --as=system:serviceaccount:wallet:default -n wallet` answers `yes`. Name two places to look to find out why, and the fix that does not break other workloads.
8. **Design.** Design the minimum set of controls so that an intruder who gets a shell in the wallet-api container cannot (a) read another namespace's Secrets, (b) reach the database from a different Pod, (c) go unnoticed. Name one tool or object for each.

**Read the diagram.** In the admission diagram, mark where Pod Security Admission, a `ValidatingAdmissionPolicy` and a Kyverno webhook sit. A request is rejected by the Kyverno webhook: which later stages never run, and does the object reach etcd?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Read the phase names under each box of the lifecycle diagram. |
| 2 | A tag is a movable label; a digest is a hash of the content. |
| 3 | Mutations can change what validation then sees. |
| 4 | Enforce applies to Pods, not to the Deployment; look at the ReplicaSet's events. |
| 5 | The signature lives next to the image; the public key lives in the policy. |
| 6 | Look for `failurePolicy` and for which namespaces the webhook excludes. |
| 7 | RoleBindings and ClusterRoleBindings both count; permissions only add. |
| 8 | One control per attack: RBAC, NetworkPolicy, runtime detection. |
| Diagram | Admission stages run in order; a rejection stops everything after it. |
