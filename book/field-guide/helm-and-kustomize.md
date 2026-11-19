# Helm and Kustomize

## What and why

Helm and Kustomize are two ways to produce Kubernetes manifests and keep them manageable. Helm packages templates as charts and records each install as a release you can upgrade and roll back. Kustomize patches plain YAML with overlays and is built into kubectl.

**Acts on it:** both run on your machine. Helm stores release state in the cluster; the API server only ever sees ordinary objects.

## Diagram

{{diagram helm-and-kustomize-01.jsx | Helm and Kustomize paths · 2 flows}}

Both end as ordinary API objects; the difference is what is remembered afterwards.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 with built-in Kustomize v5.8.1, **Helm v4.3.1** (2026-11-17). Helm 4 applies manifests with server-side apply by default and renames some flags (see Key fields); the Helm version on the exam machines is not verified here (Helm 3 uses `--atomic`), so check `helm version` first. The chart is the one `helm create shop` writes (no network needed); the Kustomize tree is a wallet-api base with a `prod` overlay.

```text
$ helm install shop ./shop -n helm-demo --set replicaCount=2 --set service.type=NodePort --set image.tag=1.31.8
NAME: shop
NAMESPACE: helm-demo
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
$ helm list -n helm-demo
NAME  NAMESPACE  REVISION  UPDATED                                 STATUS    CHART       APP VERSION
shop  helm-demo  1         2026-11-17 12:19:42.068889453 +0700 WIB deployed  shop-0.1.0  1.16.0
$ helm upgrade shop ./shop -n helm-demo --reuse-values --set replicaCount=3
$ helm rollback shop 1 -n helm-demo
Rollback was a success! Happy Helming!
$ helm history shop -n helm-demo
REVISION  UPDATED                   STATUS      CHART       APP VERSION  DESCRIPTION
1         Tue Nov 17 12:19:42 2026  superseded  shop-0.1.0  1.16.0       Install complete
2         Tue Nov 17 12:19:46 2026  superseded  shop-0.1.0  1.16.0       Upgrade complete
3         Tue Nov 17 12:19:48 2026  deployed    shop-0.1.0  1.16.0       Rollback to 1
$ kubectl -n helm-demo get deploy shop
NAME   READY   UP-TO-DATE   AVAILABLE   AGE
shop   2/2     2            2           7s
```

A rollback does not rewind history: it creates revision 3 with the content of revision 1. Kustomize needs no release object; it renders YAML that `kubectl` applies:

```yaml
# overlays/prod/kustomization.yaml (base/ holds deployment.yaml, service.yaml and a kustomization listing them)
resources: [../../base]
namespace: wallet-prod
namePrefix: prod-
labels:
- pairs: {env: prod}
replicas:
- {name: wallet-api, count: 3}
images:
- {name: wallet, newTag: v2}
patches:
- target: {kind: Deployment, name: wallet-api}
  patch: |-
    - op: add
      path: /spec/template/spec/containers/0/resources
      value: {requests: {cpu: 100m, memory: 64Mi}}
```

```text
$ kubectl kustomize overlays/prod | grep -E 'name:|namespace:|replicas:|image:|env:'
  name: prod-wallet-api
  namespace: wallet-prod
    env: prod
  replicas: 3
      - image: wallet:v2
$ kubectl apply -k overlays/prod
service/prod-wallet-api created
deployment.apps/prod-wallet-api created
$ kubectl -n wallet-prod get deploy,svc --show-labels
NAME                              READY   UP-TO-DATE   AVAILABLE   AGE   LABELS
deployment.apps/prod-wallet-api   0/3     3            0           1s    env=prod
service/prod-wallet-api           ClusterIP   10.96.17.225   <none>   80/TCP   1s   env=prod
```

(`wallet:v2` does not exist locally, so the Pods stay `ImagePullBackOff`; the point is the rendered object.) `kubectl diff -k overlays/prod` printed the full object it would create, and `kubectl delete -k` removed both objects.

## Key fields

Flags are from `helm install --help` and `helm upgrade --help` (v4.3.1); chart files are from the generated chart; Kustomize fields are the ones used above.

| Item | Meaning | Default |
| --- | --- | --- |
| `Chart.yaml`: `apiVersion: v2`, `name`, `version`, `appVersion` | Chart identity; `version` is the chart's, `appVersion` the application's | required |
| `values.yaml` | Default values; read in templates as `.Values.replicaCount` |  |
| `templates/*.yaml`, `_helpers.tpl` | Go templates rendered into manifests |  |
| `--set k=v`, `-f file.yaml` | Override values; later wins | chart defaults |
| `helm upgrade --reuse-values` / `--reset-values` | Keep the last release's values, or go back to the chart's | `--reset-values` |
| `helm upgrade -i`, `--create-namespace` | Install if absent; create the namespace | off |
| `--wait`, `--timeout` | Wait until resources are ready, up to the timeout | `--timeout 5m0s` |
| `--rollback-on-failure` | Roll back to the last good revision on failure. Helm 4 name for `--atomic`, the only name in Helm 3; Helm 4 still accepts `--atomic` but prints a deprecation warning ([Helm 4 overview](https://helm.sh/docs/overview), [helm upgrade](https://helm.sh/docs/helm/helm_upgrade/)) | off |
| `--dry-run=client\|server`, `helm template`, `helm lint` | Render or simulate without installing; check a chart |  |
| `--server-side` | Apply with server-side apply | `true` on install in v4 |
| `--history-max` | Revisions kept per release (the rollback targets) | `10` |
| `kustomization.yaml`: `resources`, `namespace`, `namePrefix`, `labels`, `replicas`, `images`, `patches` | Which files to include, then transformations applied to every object | none |
| `kubectl kustomize <dir>`, `kubectl apply -k <dir>`, `kubectl diff -k <dir>` | Render, apply and preview |  |

Sources: [Helm docs](https://helm.sh/docs/), [Kustomize in the Kubernetes docs](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/). Helm keeps each release as Secrets in the release namespace (`helm history` reads them).

## kubectl

```bash
helm create shop                                   # a starter chart
helm lint ./shop; helm template shop ./shop --set replicaCount=2 | less   # render offline
helm install shop ./shop -n helm-demo --create-namespace -f values.yaml --set image.tag=1.31.8
helm upgrade --install shop ./shop -n helm-demo --reuse-values --set replicaCount=3 --wait --timeout 2m
helm list -A; helm status shop -n helm-demo; helm get values shop -n helm-demo; helm get manifest shop -n helm-demo
helm history shop -n helm-demo; helm rollback shop <revision> -n helm-demo
helm uninstall shop -n helm-demo
helm repo add <name> <url>; helm repo update; helm search repo <word>; helm show values <repo>/<chart>

kubectl kustomize overlays/prod                   # render to stdout
kubectl diff -k overlays/prod                     # what would change
kubectl apply -k overlays/prod                    # apply; kubectl delete -k removes
kubectl get -k overlays/prod                      # status of what the kustomization renders
```

## How it fails

All rows were reproduced on the test cluster or with the rendering commands.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Error: INSTALLATION FAILED: release name check failed: cannot reuse a name that is still in use` | A release called `shop` already exists in the namespace | `helm upgrade --install`, or choose another name, or `helm uninstall` first |
| `Error: INSTALLATION FAILED: unable to continue with install: Deployment "preexisting" in namespace "helm-demo" exists and cannot be imported into the current release: invalid ownership metadata; label validation error: missing key "app.kubernetes.io/managed-by": must be set to "Helm"; ...` | The chart would create an object that already exists and was not made by Helm | Delete or rename the old object, or adopt it by adding the Helm labels and annotations |
| `Error: UPGRADE FAILED: server-side apply failed for object helm-demo/shop apps/v1, Kind=Deployment: ... .spec.replicas: expected numeric (int or float), got string` (`--set replicaCount=abc`); `helm history` then shows revision 4 `failed` | A wrong value type reaches the API server; the failed revision stays in history; the running release is unchanged | Correct the value; `helm rollback shop <last good revision>` if the cluster was left half-changed |
| `Error: UPGRADE FAILED: resource Deployment/helm-demo/shop not ready. status: InProgress, message: Pending termination: 1 / context deadline exceeded` (bad image tag with `--wait --timeout 25s`) | The new Pods never became ready, so `--wait` timed out and recorded a failed revision | Fix the image, or use `--rollback-on-failure`; `helm rollback shop 3 --wait` restored the service in the test |
| `Error: shop/templates/deployment.yaml:9:22 executing "shop/templates/deployment.yaml" at <.Values.scaling.count>: nil pointer evaluating interface {}.count`; `helm lint` reports `[ERROR] templates/service.yaml: unable to parse YAML: ... mapping values are not allowed in this context` | A template reads a value that is not in `values.yaml`, or renders invalid YAML | `helm template --debug`; fix the key or the template |
| `kubectl kustomize` stops with `error: accumulating resources: ... accumulating resources from 'svc.yaml': evalsymlink failure on '.../base/svc.yaml' : lstat ...: no such file or directory`; or `error: invalid Kustomization: json: unknown field "namePrefx"` | A file listed under `resources` does not exist; a misspelt field | Fix the path or the field name; the error names both |
| A patch with `target: {kind: Deployment, name: wallet-apii}` renders without error but the output has no `resources:` block (count of `resources:` lines: 0) | The target matched nothing, so the patch was silently not applied | Compare the target `name` with the base's name (before `namePrefix`); always read the rendered output |

## Related

- **Cards:** Deployment (group 3), ConfigMap and Secret (group 5), Namespace (group 2), Server-side apply and field managers (group 2).
- **Chapter and lab:** 7.1.
- **Exam:** CKA Cluster Architecture (25%): use Helm and Kustomize to install cluster components; CKAD Application Deployment (20%): Helm; KCNA Cloud Native Application Delivery.
