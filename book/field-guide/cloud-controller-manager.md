# cloud-controller-manager

## What and why

A Service of type `LoadBalancer` needs a real load balancer, and a new node needs to learn which cloud VM it is. That knowledge is specific to each cloud, so it does not belong in the core. The **cloud-controller-manager** separates the components that interact with the cloud platform from those that only interact with the cluster, so cloud providers can release at their own pace ([cloud controller docs](https://kubernetes.io/docs/concepts/architecture/cloud-controller/)).

It runs three controllers. The **node** controller sets a Node's cloud identity and address and removes the Node object if its VM was deleted. The **route** controller configures cloud routes so Pods on different nodes can reach each other. The **service** controller creates cloud load balancers for Services that need them. Clusters without a cloud, such as kind or bare metal, run none.

## Diagram

{{diagram cloud-controller-manager-01.jsx | cloud-controller-manager · 3 cloud-facing loops}}
Cloud-specific logic lives in this one component, so the rest of Kubernetes stays cloud-neutral.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16). kind runs no cloud-controller-manager, so this example shows what its absence looks like. A cloud-run cluster would show a cloud-controller-manager Pod and a `providerID` such as `aws://...` instead.

```
$ kubectl get node -o jsonpath='{.items[0].spec.providerID}'
kind://docker/cnlab/cnlab-control-plane
$ kubectl -n kube-system get pods | grep -i cloud
                                  (no output: no cloud-controller-manager Pod)
$ kubectl -n kube-system get pod kube-controller-manager-cnlab-control-plane -o jsonpath='{.spec.containers[0].command}' | grep cloud-provider
                                  (no output: no --cloud-provider flag)
$ kubectl apply -f lb.yaml; sleep 5; kubectl get svc lb-demo     # a Service with type: LoadBalancer
NAME      TYPE           CLUSTER-IP     EXTERNAL-IP   PORT(S)        AGE
lb-demo   LoadBalancer   10.96.135.74   <pending>     80:30789/TCP   5s
```

The Service is accepted and gets a ClusterIP and a node port, but `EXTERNAL-IP` stays `<pending>`: no component asks a cloud for a load balancer.

## Key fields

The cloud-controller-manager is built by each cloud vendor, so its flags differ; the common part is how the cluster is told to use it.

| Setting | Meaning | Default |
| --- | --- | --- |
| `kubelet --cloud-provider=external` | Tell the kubelet that an external manager will initialise the node | not set; kind and bare metal set nothing |
| `Node.spec.providerID` | The cloud's ID of the VM, set by the node controller | empty on bare metal; `kind://docker/<cluster>/<node>` in kind |
| `Node` taint `node.cloudprovider.kubernetes.io/uninitialized` | Keeps Pods off a node until the cloud-controller-manager has initialised it | effect NoSchedule, added by components started with `--cloud-provider=external` (not run here) |
| `Service.spec.type: LoadBalancer` | Asks the service controller for a cloud load balancer | `ClusterIP` for Services |
| `--cloud-provider`, `--cloud-config` (vendor binary) | Which cloud and its credentials | vendor specific |

Rows one, three and five were not run on kind and were not checked against a source page in this session (treat them as unverified); rows two and four were observed in the example.

Source for the taint: the [Cloud Controller Manager Administration](https://kubernetes.io/docs/tasks/administer-cluster/running-cloud-controller/) page says components started with `--cloud-provider=external` add `node.cloudprovider.kubernetes.io/uninitialized` with effect `NoSchedule`, and that if the cloud-controller-manager is unavailable, new nodes stay unschedulable. Checked 2026-11-17; not reproduced on kind.

## kubectl

```
kubectl get node -o jsonpath='{.items[*].spec.providerID}'      # cloud ID of each node
kubectl get node -o jsonpath='{.items[0].spec.taints}'          # uninitialized taint, if any
kubectl -n kube-system get pods | grep -i cloud                  # is a CCM running?
kubectl get svc -A | grep LoadBalancer                           # which Services want a load balancer
kubectl describe svc lb-demo                                     # Events from the service controller
kubectl -n kube-system logs -l k8s-app=cloud-controller-manager   # not run: label differs per vendor
```

## How it fails

Row one was reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `EXTERNAL-IP` stays `<pending>` for a `type: LoadBalancer` Service (`lb-demo ... <pending>   80:30789/TCP`); `kubectl describe svc` shows no Events | No cloud-controller-manager (or no load-balancer provider such as MetalLB) is installed, so nothing creates the load balancer | Install the provider for your environment; on kind use NodePort or a load-balancer add-on |
| New nodes stay unschedulable, tainted `node.cloudprovider.kubernetes.io/uninitialized` (not reproduced) | The kubelet runs with `--cloud-provider=external` but the cloud-controller-manager is down or lacks cloud credentials | Check the CCM Pod and its logs; fix credentials |
| A deleted cloud VM leaves its Node object (not reproduced) | The node controller that removes Nodes of deleted VMs is not running | Restore the CCM; delete the stale Node manually |

## Related

- **Cards:** kube-controller-manager and its controllers; Service (group 4: type LoadBalancer); Node (group 7); Cluster Autoscaler and Karpenter (group 8).
- **Chapter and lab:** Chapters 5.1 and 5.5 (Vol 5); not run in the kind labs.
- **Exam domain:** CKA Troubleshooting: cluster components; KCNA Kubernetes Fundamentals.
