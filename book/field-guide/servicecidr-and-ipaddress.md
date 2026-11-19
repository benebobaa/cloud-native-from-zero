# ServiceCIDR and IPAddress

## What and why

A ServiceCIDR is a cluster-wide range of IP addresses that Services may use as ClusterIPs; an IPAddress object records each address in use. The range used to be a fixed kube-apiserver flag, so a cluster that ran out of Service IPs needed reconfiguring. Now an admin adds a range by creating another ServiceCIDR (stable since Kubernetes v1.33).

The **kube-apiserver allocator** picks a free IP when you create a Service and creates an IPAddress whose `parentRef` names the Service. During bootstrap the API server creates the default ServiceCIDR, named `kubernetes`, from `--service-cluster-ip-range`.

## Diagram

{{diagram servicecidr-and-ipaddress-01.jsx | ClusterIP allocation · 4 objects}}
Creating a Service makes the API server pick a free IP from a ServiceCIDR and record it as an IPAddress object.

## Minimal example

Tested on kind v0.33.0 with `kindest/node:v1.37.0` and kubectl v1.37.1 (2026-11-16). The default range and its IPAddress records exist from the start:

```
$ kubectl get servicecidr
NAME         CIDRS          AGE
kubernetes   10.96.0.0/16   95s

$ kubectl get ipaddress | head -4
NAME            PARENTREF
10.96.0.1       services/default/kubernetes
10.96.0.10      services/kube-system/kube-dns
10.96.120.234   services/default/web-badport

$ kubectl get ipaddress 10.96.0.1 -o yaml
metadata:
  labels:
    ipaddress.kubernetes.io/ip-family: IPv4
    ipaddress.kubernetes.io/managed-by: ipallocator.k8s.io
  name: 10.96.0.1
spec:
  parentRef: {name: kubernetes, namespace: default, resource: services}
```

Add a second range, then create a Service that asks for an address inside it:

```yaml
apiVersion: networking.k8s.io/v1
kind: ServiceCIDR
metadata: {name: extra}
spec:
  cidrs: ["10.200.0.0/24"]
---
apiVersion: v1
kind: Service
metadata: {name: pinned}
spec:
  clusterIP: 10.200.0.77
  selector: {app: web}
  ports: [{port: 80}]
```

```
$ kubectl get servicecidr
NAME         CIDRS           AGE
extra        10.200.0.0/24   0s
kubernetes   10.96.0.0/16    96s
$ kubectl get svc pinned -o wide; kubectl get ipaddress 10.200.0.77
NAME     TYPE        CLUSTER-IP    EXTERNAL-IP   PORT(S)   AGE   SELECTOR
pinned   ClusterIP   10.200.0.77   <none>        80/TCP    0s    app=web
NAME          PARENTREF
10.200.0.77   services/default/pinned
```

## Key fields

Checked with `kubectl explain servicecidr` and `ipaddress` on 1.37 and the API reference.

| Field | Meaning | Default |
| --- | --- | --- |
| ServiceCIDR `spec.cidrs` | IP blocks to allocate ClusterIPs from; at most two, one per IP family; immutable | required |
| ServiceCIDR `status.conditions` | `Ready` is `True` when the range is usable, `False` with reason `Terminating` while IPs still use it | set by the controller |
| finalizer `networking.k8s.io/service-cidr-finalizer` | keeps a range alive while IPAddresses point at it | added by the controller |
| IPAddress `metadata.name` | the address itself, in canonical form | required |
| IPAddress `spec.parentRef` | `group`, `resource`, `namespace`, `name` of the object that owns the address (a Service) | required |
| labels `ipaddress.kubernetes.io/ip-family`, `ipaddress.kubernetes.io/managed-by` | family and allocator that created the record | set by the allocator |
| kube-apiserver `--service-cluster-ip-range` | creates the default ServiceCIDR `kubernetes` at bootstrap | set by the installer |

## kubectl

```bash
kubectl get servicecidr                                   # ranges and their CIDRS
kubectl get servicecidr kubernetes -o yaml                # Ready condition, finalizer
kubectl get ipaddress                                     # every allocated ClusterIP and its PARENTREF
kubectl get ipaddress 10.96.0.1 -o yaml
kubectl apply -f svccidr.yaml                             # add a range
kubectl get svc pinned -o wide                            # the Service that uses it
```

## How it fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The Service "pinned-out" is invalid: spec.clusterIPs: Invalid value: ["10.222.0.5"]: failed to allocate IP 10.222.0.5: the provided network does not match the current range` | The requested `clusterIP` is outside every ServiceCIDR | Pick an address inside a range, or add a ServiceCIDR that covers it |
| `The Service "dup" is invalid: spec.clusterIPs: Invalid value: ["10.200.0.77"]: failed to allocate IP 10.200.0.77: provided IP is already allocated` | Another Service already holds that address (it has an IPAddress record) | Omit `clusterIP` or choose a free one; `kubectl get ipaddress` shows who owns it |
| `kubectl delete servicecidr kubernetes` returns, but the object stays with a `deletionTimestamp`; `Ready=False`, reason `Terminating`, message `There are still IPAddresses referencing the ServiceCIDR, please remove them or create a new ServiceCIDR` | The finalizer keeps a range while IPAddresses use it | Move or delete the Services first, or add a range that covers them, before deleting the old one |

## Related

- **Cards:** Service, kube-apiserver (hosts the allocator), DNS for Services and Pods
- **Chapter and lab:** Ch 5.3 and Lab 5.3
- **Exam:** no matching row in the coverage matrix; nearest domain is Services and Networking (20%)
- **Source:** [Virtual IPs and service proxies: IP address allocation](https://kubernetes.io/docs/reference/networking/virtual-ips/), [Service ClusterIP allocation](https://kubernetes.io/docs/concepts/services-networking/cluster-ip-allocation/)
