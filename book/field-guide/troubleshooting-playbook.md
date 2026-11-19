# Troubleshooting playbook

## What and why

The troubleshooting playbook is a fixed order for finding the failing layer: Pod, events and logs, Service, node, control plane, then etcd and certificates. It matters because troubleshooting is 30% of the CKA.

**Acts on it:** nothing runs it; you use kubectl and, on a node, `systemctl` and `journalctl`. The card also covers ComponentStatus, a deprecated API that still exists.

## Diagram

{{diagram troubleshooting-playbook-01.jsx | Troubleshooting order · 6 layers}}

A symptom names a layer; the table below lists the first command and the usual cause for each.

## Minimal example

Tested on kind v0.33.0 (2 nodes), node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). The playbook is a loop: read the symptom in `kubectl get`, ask `describe` or the events for the reason, then logs, then the node. Each step below was run against a Pod that was broken on purpose.

```text
$ kubectl get nodes
NAME                       STATUS   ROLES           AGE   VERSION
cnlab-control-plane        Ready    control-plane   24m   v1.37.0
cnlab-worker               Ready    <none>          24m   v1.37.0
$ kubectl get --raw='/readyz?verbose' | tail -3
[+]shutdown ok
readyz check passed
$ kubectl -n tb get pod big                  # asks for 64 CPUs
NAME   READY   STATUS    RESTARTS   AGE
big    0/1     Pending   0          6s
$ kubectl -n tb get events --field-selector reason=FailedScheduling -o jsonpath='{.items[0].message}'
0/2 nodes are available: 1 Insufficient cpu, 1 node(s) had untolerated taint(s). preemption: 0/2 nodes are available: 2 Preemption is not helpful for scheduling.
$ kubectl -n tb get pod typo                 # image nginx:1.31.88
NAME   READY   STATUS             RESTARTS   AGE
typo   0/1     ImagePullBackOff   0          26s
$ kubectl -n tb describe pod typo | grep 'Failed to pull'
  Warning  Failed     6s (x2 over 23s)  kubelet  Failed to pull image "nginx:1.31.88": rpc error: code = NotFound desc = failed to pull and unpack image "docker.io/library/nginx:1.31.88": ... docker.io/library/nginx:1.31.88: not found
$ kubectl -n tb get pod crash && kubectl -n tb logs crash
NAME    READY   STATUS   RESTARTS      AGE
crash   0/1     Error    2 (39s ago)   41s
cannot open /etc/app.conf
$ kubectl -n tb get pod oom -o jsonpath='{.status.containerStatuses[0].lastState.terminated}'
{"exitCode":137,"reason":"OOMKilled", ...}
$ kubectl -n tb get endpointslices -l kubernetes.io/service-name=web      # Service selector typo
NAME        ADDRESSTYPE   PORTS     ENDPOINTS   AGE
web-wjh9t   IPv4          <unset>   <unset>     2s
$ kubectl -n tb run curl --rm -i --restart=Never --image=busybox:1.37 -- wget -qO- -T 3 http://web
wget: can't connect to remote host (10.96.131.152): Connection refused
$ kubectl -n tb run curl3 --rm -i --restart=Never --image=busybox:1.37 -- nslookup nosuch.tb.svc.cluster.local
** server can't find nosuch.tb.svc.cluster.local: NXDOMAIN
```

A missing PVC class gave the Pending reason `0/2 nodes are available: pod has unbound immediate PersistentVolumeClaims.` (`kubectl get pvc` showed `orphan   Pending ... nosuch`).

## Key fields

A playbook has no fields; this table is the lookup from what `kubectl get` shows to the next command, built from the cases above.

| What you see | Ask next | The answer looked like | Card |
| --- | --- | --- | --- |
| Node `NotReady` | `kubectl describe node`, then `systemctl status kubelet` on the node | `Kubelet stopped posting node status.`; `inactive` | Node, kubelet |
| Pod `Pending` | `kubectl get events --field-selector reason=FailedScheduling` | `Insufficient cpu`; `unbound immediate PersistentVolumeClaims`; `untolerated taint(s)` | kube-scheduler, Requests, limits and QoS, PersistentVolumeClaim |
| `ImagePullBackOff` / `ErrImagePull` | `kubectl describe pod`, Events | `failed to pull and unpack image ...: not found` | Pod |
| `CrashLoopBackOff` / `Error` | `kubectl logs --previous`; `describe` Last State | `cannot open /etc/app.conf`; `Exit Code: 1` | Pod lifecycle and probes; Logs, events and kubectl debug |
| `OOMKilled` | `kubectl get pod -o jsonpath='{...lastState.terminated}'` | `reason: OOMKilled`, `exitCode: 137` | Requests, limits and QoS |
| `CreateContainerConfigError` | `describe pod` | `container has runAsNonRoot and image will run as root`; missing ConfigMap key or Secret | SecurityContext, ConfigMap, Secret |
| Running but unreachable | `kubectl get endpointslices -l kubernetes.io/service-name=<svc>` | `ENDPOINTS <unset>` | Service, EndpointSlice |
| Name does not resolve | `nslookup` from a Pod | `NXDOMAIN` for a wrong name | DNS for Services and Pods, CoreDNS |
| Everything slow or `kubectl` errors | `kubectl get --raw='/readyz?verbose'`; Pods in `kube-system` | `readyz check passed` | kube-apiserver, etcd |

## kubectl

```bash
kubectl get nodes -o wide
kubectl get pods -A | grep -v Running                  # everything that is not healthy
kubectl get pods -n kube-system                        # control-plane and add-on Pods
kubectl get --raw='/readyz?verbose'                    # API server self-check, one line per check
kubectl describe pod <pod>                             # Events at the bottom
kubectl get events -A --sort-by=.lastTimestamp | tail -20
kubectl logs <pod> [--previous] [-c <container>]
kubectl get endpointslices -l kubernetes.io/service-name=<svc>
kubectl run curl --rm -it --restart=Never --image=busybox:1.37 -- sh   # test DNS and Services from inside
kubectl top nodes; kubectl top pods -A --sort-by=memory
# on a node (ssh in the exam; docker exec on kind):
systemctl status kubelet; journalctl -u kubelet -n 50 --no-pager
crictl ps -a; crictl logs <container-id>
ls /etc/kubernetes/manifests                           # static Pods: apiserver, scheduler, controller-manager, etcd
```

`kubectl get componentstatuses` still exists but prints `Warning: v1 ComponentStatus is deprecated in v1.19+`; use `/readyz?verbose` and the `kube-system` Pods instead.

## How it fails

All rows were reproduced on the test cluster. These are the ways troubleshooting itself goes wrong.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `kubectl get nodes` shows the worker `NotReady`; `describe node` says `Kubelet stopped posting node status.` on all four conditions; taints `node.kubernetes.io/unreachable:NoSchedule` and `:NoExecute` appear; `docker exec cnlab-worker systemctl is-active kubelet` prints `inactive`; `crictl ps` on the node still lists the running containers | The kubelet is down, not the containers: the control plane lost the heartbeat after about 40 s | On the node: `systemctl start kubelet` (the node was `Ready` again in 15 s), then read `journalctl -u kubelet` for why it stopped |
| A new Pod stays `Pending` with no `FailedScheduling` event at all (`kubectl -n kube-system get pods -l component=kube-scheduler` shows `No resources found`) | The scheduler is not running: moving `/etc/kubernetes/manifests/kube-scheduler.yaml` away stopped the static Pod. Nothing says so on the Pod, because no scheduler existed to write the event | Check `kube-system` Pods and `ls /etc/kubernetes/manifests` on the control-plane node; after the manifest was put back the Pending Pod ran within 40 s |
| `E1117 ... memcache.go:381] "Couldn't get current server API group list" err="Get \"http://localhost:8080/api?timeout=32s\": dial tcp 127.0.0.1:8080: connect: connection refused"` then `The connection to the server localhost:8080 was refused - did you specify the right host or port?` | kubectl has no kubeconfig (here `KUBECONFIG=/dev/null`) so it falls back to localhost:8080: the cluster is fine | `echo $KUBECONFIG; kubectl config current-context`; see the kubeconfig and contexts card |

A status like `Error` can hide the reason: `Pending` has three different causes above and `CreateContainerConfigError` has two. Always read the Events before changing anything.

## Related

- **Cards:** Group 1 cards, Node (group 7), Service and DNS for Services and Pods (group 4), kubelet (group 1), Logs, events and kubectl debug.
- **Chapter and lab:** 5.5.
- **Exam:** CKA Troubleshooting (30%): clusters and nodes, cluster components, services and networking.
