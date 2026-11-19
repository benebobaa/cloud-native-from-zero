# API Priority and Fairness

## What and why

One misbehaving controller that retries in a tight loop can use every request slot of the API server and starve everything else, including the kubelets. **API Priority and Fairness (APF)** classifies and isolates requests more finely than a single in-flight limit, adds limited queuing so short bursts are not rejected, and uses fair queuing so one badly behaved client cannot starve others at the same level ([flow control docs](https://kubernetes.io/docs/concepts/cluster-administration/flow-control/)). It is on by default (`--enable-priority-and-fairness`), and the API group is stable as `flowcontrol.apiserver.k8s.io/v1`.

A **FlowSchema** matches requests (by user, group, verb, resource) and assigns them to a **PriorityLevelConfiguration**, which has its own share of the server's concurrency. The kube-apiserver itself enforces this on every request. Long-running requests such as `exec` and log tailing are not subject to APF; watch requests are.

## Diagram

{{diagram api-priority-and-fairness-01.jsx | APF request path · FlowSchema to priority level}}
A FlowSchema classifies the request, the priority level it points to decides how many requests run at once, and requests that cannot be queued are rejected with 429.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). The cluster ships default FlowSchemas and priority levels; read them, then add a deliberately tiny level for one ServiceAccount.

```
$ kubectl get flowschemas | head -6
NAME                     PRIORITYLEVEL     MATCHINGPRECEDENCE   DISTINGUISHERMETHOD   AGE     MISSINGPL
exempt                   exempt            1                    <none>                3m28s   False
probes                   exempt            2                    <none>                3m29s   False
system-leader-election   leader-election   100                  ByUser                3m29s   False
system-node-high         node-high         400                  ByUser                3m29s   False
system-nodes             system            500                  ByUser                3m29s   False
$ kubectl get prioritylevelconfigurations
NAME              TYPE      NOMINALCONCURRENCYSHARES   QUEUES   HANDSIZE   QUEUELENGTHLIMIT
catch-all         Limited   5                          <none>   <none>     <none>
exempt            Exempt    <none>                     <none>   <none>     <none>
global-default    Limited   20                         128      6          50
leader-election   Limited   10                         16       4          50
node-high         Limited   40                         64       6          50
system            Limited   30                         64       6          50
workload-high     Limited   40                         128      6          50
workload-low      Limited   100                        128      6          50
$ kubectl get pods -v=8 2>&1 | grep -i x-kubernetes-pf          # every response says which schema and level handled it
	X-Kubernetes-Pf-Flowschema-Uid: a70c07f0-db82-4a2b-ba99-5304d4792f4a
	X-Kubernetes-Pf-Prioritylevel-Uid: 28b5dc42-39b4-4269-b7f3-9f14c210622c
$ kubectl get --raw /debug/api_priority_and_fairness/dump_priority_levels | head -3
PriorityLevelName, ActiveQueues, IsIdle, IsQuiescing, WaitingRequests, ExecutingRequests, DispatchedRequests, RejectedRequests, ...
catch-all,         0,            true,   false,       0,               0,                 66,                 0, ...
exempt,            0,            true,   false,       0,               0,                 893,                0, ...
```

(The list shows 11 FlowSchemas in total; only the first rows are quoted.) The new level and its FlowSchema:

```yaml
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: PriorityLevelConfiguration
metadata: {name: tiny}
spec:
  type: Limited
  limited: {nominalConcurrencyShares: 1, lendablePercent: 0, limitResponse: {type: Reject}}
---
apiVersion: flowcontrol.apiserver.k8s.io/v1
kind: FlowSchema
metadata: {name: tiny-fs}
spec:
  matchingPrecedence: 50
  priorityLevelConfiguration: {name: tiny}
  rules:
  - subjects: [{kind: ServiceAccount, serviceAccount: {name: apf-test, namespace: x6}}]
    resourceRules: [{verbs: ["list"], apiGroups: [""], resources: ["pods"], clusterScope: true, namespaces: ["*"]}]
```

## Key fields

Default values below are read from this cluster's built-in objects; field meanings from the flow-control documentation and the v1.37.0 spec.

| Field | Meaning | Value in the built-in `workload-high` |
| --- | --- | --- |
| `FlowSchema.spec.matchingPrecedence` | Order of evaluation among FlowSchemas; the lowest number that matches wins; only `exempt` may use 1 | 800 for kube-controller-manager |
| `FlowSchema.spec.priorityLevelConfiguration.name` | The level requests are sent to | `workload-high` |
| `FlowSchema.spec.distinguisherMethod.type` | How requests split into flows inside a level: `ByUser` or `ByNamespace` | `ByNamespace` |
| `FlowSchema.spec.rules[]` | `subjects` (user, group, ServiceAccount) plus `resourceRules` or `nonResourceRules` | per schema |
| `PriorityLevelConfiguration.spec.type` | `Limited` or `Exempt` | `Limited` |
| `limited.nominalConcurrencyShares` | The level's share of the server's concurrency | 40 |
| `limited.lendablePercent` | Share of its seats it lends to other levels | 50 |
| `limited.limitResponse.type` | `Queue` (wait) or `Reject` (return 429 at once) | `Queue` |
| `limitResponse.queuing.queues`, `handSize`, `queueLengthLimit` | Queue count, shuffle-shard hand size, length per queue | 128, 6, 50 |

## kubectl

```
kubectl get flowschemas                                  # MISSINGPL=True means a dangling reference
kubectl get prioritylevelconfigurations
kubectl get prioritylevelconfiguration workload-high -o yaml
kubectl get --raw /debug/api_priority_and_fairness/dump_priority_levels    # live queue and reject counters
kubectl get pods -v=8 2>&1 | grep -i x-kubernetes-pf    # which schema and level served a request
kubectl get --raw /metrics | grep apiserver_flowcontrol_rejected_requests_total
kubectl get flowschema <name> -o jsonpath='{.status.conditions}'
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| 6,000 parallel `GET /api/v1/pods` calls with the ServiceAccount's token: `4816` returned `200` and `1184` returned `429`; metric `apiserver_flowcontrol_rejected_requests_total{flow_schema="tiny-fs",priority_level="tiny",reason="concurrency-limit"} 1184` | The level `tiny` has 1 share and `limitResponse: Reject`, so requests that find no free seat are rejected instead of queued | Raise `nominalConcurrencyShares`, use `type: Queue`, and make clients back off and retry (controllers do) |
| `kubectl get flowschema dangling` shows `MISSINGPL True`; condition `Dangling=True NotFound: This FlowSchema references the PriorityLevelConfiguration object named "does-not-exist" but there is no such object` | The schema points at a level that does not exist | Create the level or fix the name |
| `The FlowSchema "tiny-fs" is invalid: spec.matchingPrecedence: Invalid value: 1: only the schema named 'exempt' may have matchingPrecedence 1` | Precedence 1 is reserved for the built-in `exempt` schema | Use 2 or higher (50 worked) |

A first attempt with `resourceRules` for `configmaps` and `namespaces: ["*"]` but no `clusterScope: true` matched no requests: the cluster-wide `GET /api/v1/configmaps` calls were all dispatched elsewhere (0 on `tiny`). Matching an all-namespaces list needed `clusterScope: true`.

## Related

- **Cards:** kube-apiserver; Watch and resourceVersion; Lease (leader-election traffic has its own priority level); Admission webhooks (group 9: priority inversion warning).
- **Chapter and lab:** card only; no chapter teaches it (see the coverage matrix).
- **Exam domain:** KCNA Kubernetes Fundamentals (background knowledge).
