# API groups, versions and deprecation

## What and why

Kubernetes has hundreds of resource types that evolve at different speeds, so the API is split into **groups** (`apps`, `batch`, `networking.k8s.io`; the core group has no name) and each group has **versions** (`v1alpha1`, `v1beta1`, `v1`). The `apiVersion` field of a manifest is `group/version`, or just `version` for the core group. The API server serves several versions at once and converts between them, so a manifest written for an older version keeps working until that version is removed.

When a version is deprecated the server keeps serving it but returns a warning that kubectl prints; once removed, requests for it fail. Knowing how to find what the server offers (`kubectl api-versions`, `api-resources`, `explain`) and how to move a manifest to a newer version are the skill behind the CKAD curriculum item "Understand API deprecations" ([CKAD 1.37 curriculum](https://github.com/cncf/curriculum/blob/main/CKAD_Curriculum_v1.37.pdf)).

## Diagram

{{diagram api-groups-versions-and-deprecation-01.jsx | REST path anatomy and version maturity}}
The `apiVersion` in a manifest is the group and version in this path; a version moves from alpha to stable, then is deprecated and eventually removed.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-16).

```
$ kubectl api-versions | wc -l; kubectl api-versions | head -4
23
admissionregistration.k8s.io/v1
apiextensions.k8s.io/v1
apiregistration.k8s.io/v1
apps/v1
$ kubectl get --raw /apis/autoscaling | python3 -m json.tool        # group with two versions
  "versions": [ {"groupVersion": "autoscaling/v2"}, {"groupVersion": "autoscaling/v1"} ],
  "preferredVersion": {"groupVersion": "autoscaling/v2"}
$ kubectl explain hpa --api-version=autoscaling/v1 | head -3; kubectl explain hpa | head -3
GROUP:      autoscaling
KIND:       HorizontalPodAutoscaler
VERSION:    v1                      # explicit v1, then the default v2
VERSION:    v2
$ kubectl get endpoints
Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice
No resources found in t2 namespace.
```

The `Warning:` line is how a deprecated API announces itself; the call still succeeds. A deprecated beta version stays served for at least 9 months or 3 minor releases, whichever is longer, and a GA version is not removed within a major version ([deprecation policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/)).

## Key fields

Values are from the test cluster (Kubernetes 1.37.0) unless noted.

| Field or path | Meaning | Value or default |
| --- | --- | --- |
| `apiVersion` (manifest) | `group/version`, or only `version` for the core group | required |
| `kind` (manifest) | The type within that group and version | required |
| `/api/v1/...` | REST path of the core group (Pod, Service, ConfigMap, Namespace, Node) | no group name |
| `/apis/<group>/<version>/...` | REST path of every named group (`apps`, `batch`, `networking.k8s.io`, ...) | 23 group-versions served here |
| `preferredVersion` in `/apis/<group>` | The version clients use when none is named | `autoscaling/v2` for `autoscaling` |
| kube-apiserver `--runtime-config` | Switch API versions on or off, for example `flowcontrol.apiserver.k8s.io/v1beta3=false` (example from the flow-control docs) | kind passes an empty value |
| `Warning:` header | Sent with responses that used a deprecated API; kubectl prints it | none |
| Metric `apiserver_requested_deprecated_apis` | Counts calls to deprecated APIs by group, version and resource | `endpoints` `v1` was counted once in the test |

## kubectl

```
kubectl api-versions                          # every group/version the server serves
kubectl api-resources                         # kinds, short names, API version, namespaced or not
kubectl api-resources --api-group=apps -o wide
kubectl explain hpa --api-version=autoscaling/v1   # fields of one specific version
kubectl get --raw /apis/autoscaling           # the group's versions and preferred version
kubectl get --raw /metrics | grep apiserver_requested_deprecated_apis   # which deprecated APIs were called
kubectl convert -f old.yaml --output-version networking.k8s.io/v1      # not run: separate kubectl-convert plug-in
```

## How it fails

All three were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `error: resource mapping not found for name: "old" ... no matches for kind "Ingress" in version "extensions/v1beta1"` followed by `ensure CRDs are installed first` | The manifest uses an API version that has been removed | Change `apiVersion` to a served one (`kubectl api-versions`) and fix any changed fields; for Ingress that is `networking.k8s.io/v1` |
| The same error for `networking.k8s.io/v1beta1` Ingress | A beta version that is no longer served | Move to `networking.k8s.io/v1` |
| `Warning: v1 Endpoints is deprecated in v1.33+; use discovery.k8s.io/v1 EndpointSlice` on a successful command | The API is deprecated but still served; the server counts such calls in `apiserver_requested_deprecated_apis` | Migrate scripts and manifests before the API is removed; find callers with that metric |

## Related

- **Cards:** Objects, spec and status; CustomResourceDefinition (group 10: adds new groups); Upgrades and version skew (group 11); StorageVersionMigration (group 11); kube-apiserver.
- **Chapter and lab:** Chapter 5.1 and Lab 5.1 (Vol 5).
- **Exam domain:** CKAD Application Observability and Maintenance: API deprecations; KCNA Kubernetes Fundamentals.
