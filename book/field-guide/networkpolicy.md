# NetworkPolicy

## What and why

A NetworkPolicy lists which Pods may send traffic to, or receive it from, a chosen set of Pods. By default every Pod accepts traffic from every other Pod; a policy lets a team close that down.

The policy selects Pods with `podSelector`, then allows traffic by IP block, namespace or Pod selector, for ingress, egress or both. Once any policy selects a Pod for a direction, that direction denies everything not allowed (rules add up; there are no deny rules). The API only stores the rules: the **CNI plug-in** enforces them. A plug-in without policy support accepts the object and ignores it.

## Diagram

{{diagram networkpolicy-01.jsx | NetworkPolicy decision · 5 boxes}}
Selection by a policy flips a Pod from open to default-deny; only matching allow rules let traffic through.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` (its default kindnet CNI enforced the policies here) and kubectl v1.37.1 (2026-11-16). Namespace `np` holds an nginx Deployment `web` with Service `web`, a client Pod `allowed` labelled `role=client`, and a client Pod `other` with no label. Before any policy both clients reach `web`.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: default-deny-ingress}
spec:
  podSelector: {}
  policyTypes: [Ingress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: allow-client-to-web}
spec:
  podSelector: {matchLabels: {app: web}}
  policyTypes: [Ingress]
  ingress:
  - from: [{podSelector: {matchLabels: {role: client}}}]
    ports: [{protocol: TCP, port: 80}]
```

After the first policy nobody gets in. After the second, only Pods labelled `role=client` do:

```
$ kubectl -n np exec allowed -- wget -qO- -T 3 http://web
wget: download timed out
$ kubectl -n np apply -f np-allow.yaml
$ kubectl -n np exec allowed -- wget -qO- -T 3 http://web | grep -i '<title>'
<title>Welcome to nginx!</title>
$ kubectl -n np exec other -- wget -qO- -T 3 http://web
wget: download timed out
```

## Key fields

Checked with `kubectl explain networkpolicy` on 1.37.

| Field | Meaning | Default |
| --- | --- | --- |
| `spec.podSelector` | the Pods the policy applies to; an empty selector matches every Pod in the namespace | empty selector |
| `spec.policyTypes` | `Ingress`, `Egress` or both | `Ingress` always; `Egress` only if the policy has an `egress` section |
| `spec.ingress[].from[]` | allowed sources: `podSelector`, `namespaceSelector`, `ipBlock`; items are OR-ed, a missing list allows all sources | none |
| `spec.egress[].to[]` | allowed destinations, same peer types | none |
| `...ports[]` | `protocol` and `port` (number or name), optional `endPort` | all ports if empty |
| `podSelector` and `namespaceSelector` in one item | both must match (AND); as two separate items they are OR-ed | n/a |
| label `kubernetes.io/metadata.name` | set on every namespace, so a `namespaceSelector` can pick one by name | set automatically |

## kubectl

```bash
kubectl -n np apply -f np-deny.yaml
kubectl -n np get networkpolicy                           # POD-SELECTOR column
kubectl -n np describe networkpolicy allow-client-to-web  # From, ports, policy types
kubectl -n np get pods --show-labels                      # do the Pod labels match?
kubectl get ns --show-labels                              # kubernetes.io/metadata.name
kubectl -n np exec allowed -- wget -qO- -T 3 http://web   # a drop shows as a timeout
```

A timeout means packets were dropped; `Connection refused` means the packet arrived and nothing listened.

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `wget: download timed out` from a client Pod | A policy selects the target Pod and no rule allows this source (here `default-deny-ingress` with `podSelector: {}`, or the client lacks the label `role=client`) | Add an allow rule, or label the client so the rule matches |
| `wget: bad address 'web'` right after you add an egress policy | The egress rule allows only the web Pods, so the client's DNS query to CoreDNS is dropped | Also allow UDP and TCP 53 to the `kube-dns` Pods: `namespaceSelector` on `kubernetes.io/metadata.name: kube-system` plus `podSelector` on `k8s-app: kube-dns` (the version that fixed it in this test) |
| A policy exists but traffic is not blocked (documented, not reproduced; kindnet enforces policies) | The CNI plug-in does not implement NetworkPolicy, so the API accepts the object and nothing enforces it | Run a CNI that enforces policies, and test with a deny policy |

## Related

- **Cards:** CNI and CSI plug-ins (enforces policy), Service, DNS for Services and Pods (egress rules need DNS), Labels, selectors and annotations (selectors)
- **Chapter and lab:** Ch 6.1 and Lab 6.1
- **Exam:** CKA, Services and Networking (20%): network policies; CKAD, Services and Networking: NetworkPolicies
- **Source:** [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/)
