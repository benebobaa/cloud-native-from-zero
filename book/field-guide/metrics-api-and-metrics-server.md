# Metrics API and metrics-server

## What and why

The Metrics API (`metrics.k8s.io`) serves the current CPU and memory use of nodes and Pods, and metrics-server is the add-on that fills it. Without it `kubectl top` and the HPA have no data. It is not a monitoring system and keeps no history.

**Acts on it:** metrics-server scrapes each kubelet. The kube-apiserver aggregation layer routes requests for `metrics.k8s.io` to it through an APIService.

## Diagram

{{diagram metrics-api-and-metrics-server-01.jsx | Metrics API request path · 5 hops}}

The Metrics API is answered by a Pod, not by the kube-apiserver itself: the aggregation layer proxies requests to it.

## Minimal example

Tested on kind v0.33.0 (2 nodes), node image `kindest/node:v1.37.0`, kubectl v1.37.1, metrics-server v0.9.1 (2026-11-17). The manifests come from the `manifests/overlays/release` kustomization in the [metrics-server repository](https://github.com/kubernetes-sigs/metrics-server) at tag v0.9.1; on kind one argument is added, because kubelet serving certificates on kind have no IP SANs.

```bash
git clone --depth 1 --branch v0.9.1 https://github.com/kubernetes-sigs/metrics-server.git
kubectl apply -k metrics-server/manifests/overlays/release
kubectl -n kube-system patch deploy metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl -n kube-system rollout status deploy/metrics-server
```

```text
$ kubectl get apiservice v1beta1.metrics.k8s.io
NAME                     SERVICE                      AVAILABLE   AGE
v1beta1.metrics.k8s.io   kube-system/metrics-server   True        2m25s
$ kubectl top nodes
NAME                       CPU(cores)   CPU(%)   MEMORY(bytes)   MEMORY(%)
cnlab-control-plane        1238m        10%      1105Mi          14%
cnlab-worker               3243m        27%      415Mi           5%
$ kubectl top pods -n kube-system --sort-by=memory | head -4
NAME                                               CPU(cores)   MEMORY(bytes)
kube-apiserver-cnlab-control-plane                 443m         305Mi
kube-controller-manager-cnlab-control-plane        129m         69Mi
etcd-cnlab-control-plane                           226m         43Mi
$ kubectl get --raw /apis/metrics.k8s.io/v1beta1/namespaces/hpa-demo/pods | jq -c '.items[0] | {name:.metadata.name, window, containers}'
{"name":"burn-7d979c96d9-hb7db","window":"16.04s","containers":[{"name":"burn","usage":{"cpu":"200426932n","memory":"244Ki"}}]}
```

`kubectl top` is a client of the Metrics API: it prints the same `usage` numbers that the HPA reads. The `cpu` value is in nanocores (`200426932n` is about 200m).

## Key fields

The Metrics API is read-only and has no spec. Its objects are `NodeMetrics` and `PodMetrics`, produced on demand by metrics-server from the kubelets' `/metrics/resource` endpoint. Field names below are from the live objects shown above; flags are the ones in the v0.9.1 deployment manifest.

| Field or flag | Meaning | Value seen |
| --- | --- | --- |
| `timestamp` | When the sample was taken | RFC 3339 time |
| `window` | Length of the interval the usage is averaged over | `10.282s` to `16.04s` |
| `usage.cpu` | CPU used, in nanocores (`n`) | `200426932n` |
| `usage.memory` | Working-set memory, in `Ki` | `244Ki` |
| `containers[].name`, `containers[].usage` | Per-container usage inside a `PodMetrics` | one entry per container |
| `--metric-resolution` | How often metrics-server scrapes every kubelet | `15s` in the manifest |
| `--kubelet-insecure-tls` | Skip verifying the kubelet's serving certificate | absent; needed on kind |
| `--kubelet-preferred-address-types` | Order of node addresses to try when contacting a kubelet | `InternalIP,ExternalIP,Hostname` in the manifest |
| `APIService v1beta1.metrics.k8s.io` | Tells the API server to forward `/apis/metrics.k8s.io` to the `metrics-server` Service | `insecureSkipTLSVerify: true` in the manifest |

Sources: [Resource metrics pipeline](https://kubernetes.io/docs/tasks/debug/debug-cluster/resource-metrics-pipeline/) and the [metrics-server README](https://github.com/kubernetes-sigs/metrics-server). It keeps only the latest sample in memory, so it has no history and is not a monitoring system.

## kubectl

```bash
kubectl top nodes                                              # CPU and memory per node
kubectl top pods -A --sort-by=cpu                              # busiest Pods first (also --sort-by=memory)
kubectl top pod web-1 --containers -n shop                     # one row per container
kubectl top pod -l app=web -n shop                             # selector instead of a name
kubectl get apiservice v1beta1.metrics.k8s.io                  # AVAILABLE must be True
kubectl get --raw /apis/metrics.k8s.io/v1beta1/nodes           # the raw NodeMetricsList
kubectl -n kube-system get deploy,pods -l k8s-app=metrics-server
kubectl -n kube-system logs deploy/metrics-server --tail=20    # scrape and TLS errors show here
kubectl -n kube-system describe pod -l k8s-app=metrics-server  # readiness probe failures
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl top nodes` prints `error: Metrics API not available`; `kubectl get apiservice v1beta1.metrics.k8s.io` says `NotFound`; an HPA shows `unable to fetch metrics from resource metrics API: the server could not find the requested resource (get pods.metrics.k8s.io)` | metrics-server is not installed, so nothing serves `metrics.k8s.io` | Install it (Minimal example) and wait until the APIService is `True` |
| metrics-server Pod is `0/1 Running`; `v1beta1.metrics.k8s.io   kube-system/metrics-server   False (MissingEndpoints)`; `kubectl top nodes` still prints `error: Metrics API not available`; its log: `Failed to scrape node ... tls: failed to verify certificate: x509: cannot validate certificate for 172.21.0.3 because it doesn't contain any IP SANs` and `Failed probe probe="metric-storage-ready" err="no metrics to serve"` | The kubelet's serving certificate has no IP SAN (the default on kind), so metrics-server refuses to scrape and the Pod never becomes Ready | On a lab cluster add `--kubelet-insecure-tls`; on a real cluster give kubelets certificates signed by the cluster CA (`serverTLSBootstrap`) |
| A node has no metrics; the metrics-server log repeats `Failed to scrape node ... dial tcp 172.21.0.3:10250: connect: connection refused` every 15 s | metrics-server cannot reach that kubelet: the kubelet is stopped (it was, on the test worker) or port 10250 is blocked | Fix the node (Troubleshooting playbook card); the metrics return on the next scrape |

## Related

- **Cards:** HorizontalPodAutoscaler, VerticalPodAutoscaler (add-on), APIService and aggregation, Node.
- **Chapter and lab:** 7.2.
- **Exam:** CKA Troubleshooting (30%): monitor cluster and application resource usage; CKAD Application Observability and Maintenance (15%): built-in CLI monitoring.
