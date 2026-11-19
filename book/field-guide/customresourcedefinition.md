# CustomResourceDefinition

## What and why

A CustomResourceDefinition (CRD) teaches the API server a new resource type. You get a validated, watchable, RBAC-protected API for your own objects without writing an API server.

**Acts on it:** the apiextensions part of the kube-apiserver serves the new endpoint, validates objects against the schema and stores them in etcd. A controller (see Operators and custom controllers) gives the objects behaviour.

## Diagram

{{diagram customresourcedefinition-01.jsx | From CRD to stored object · 5 steps}}

Deleting the CRD deletes every object of that kind.

## Minimal example

Tested on kind v0.33.0, node image `kindest/node:v1.37.0`, kubectl v1.37.1 (2026-11-17). A `Site` type for the wallet team's static pages: an image is required, replicas default to 1.

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata: {name: sites.example.com}          # must be <plural>.<group>
spec:
  group: example.com
  scope: Namespaced
  names: {plural: sites, singular: site, kind: Site, shortNames: [st]}
  versions:
  - name: v1
    served: true
    storage: true
    subresources: {status: {}}
    additionalPrinterColumns:
    - {name: Replicas, type: integer, jsonPath: .spec.replicas}
    - {name: Ready, type: integer, jsonPath: .status.readyReplicas}
    schema:
      openAPIV3Schema:
        type: object
        properties:
          spec:
            type: object
            required: [image]
            properties:
              image: {type: string}
              replicas: {type: integer, minimum: 1, maximum: 10, default: 1}
          status:
            type: object
            properties:
              readyReplicas: {type: integer}
---
apiVersion: example.com/v1
kind: Site
metadata: {name: blog, namespace: crd-demo}
spec: {image: nginx:1.31.8}
```

```text
$ kubectl get crd sites.example.com
NAME                SCOPE        VERSIONS      CREATED AT
sites.example.com   Namespaced   v1(storage)   2026-11-17T04:54:38Z
$ kubectl api-resources --api-group=example.com
NAME    SHORTNAMES   APIVERSION       NAMESPACED   KIND
sites   st           example.com/v1   true         Site
$ kubectl -n crd-demo get sites
NAME   REPLICAS   READY
blog   1
$ kubectl explain site.spec
FIELDS:
  image	<string> -required-
  replicas	<integer>
```

The object was stored with `spec.replicas: 1` filled in by the schema default. Nothing acts on a `Site` yet: a CRD adds a type to the API, and a controller (Operators card) gives it behaviour.

## Key fields

Fields, required markers and enums are from `kubectl explain crd.spec` on the test cluster.

| Field | Meaning | Default |
| --- | --- | --- |
| `metadata.name` | Must equal `<names.plural>.<group>` | required |
| `spec.group` | API group of the new type | required |
| `spec.scope` | `Namespaced` or `Cluster` | required |
| `spec.names` | `plural` and `kind` are required; `singular`, `shortNames`, `listKind` and `categories` (for example `all`) are optional |  |
| `spec.versions[].name`, `served`, `storage` | Version name; whether the API serves it; whether it is the one written to etcd (exactly one `storage: true`) | all required |
| `spec.versions[].schema.openAPIV3Schema` | Structural schema for validation, defaulting and pruning | required in v1 |
| `spec.versions[].subresources` | `status` and/or `scale`: separate `/status` and `/scale` endpoints | none |
| `spec.versions[].additionalPrinterColumns` | Columns of `kubectl get` | Name, Age |
| `spec.versions[].deprecated`, `deprecationWarning` | Mark a version deprecated; clients see the warning | false |
| `spec.conversion.strategy` | `None` (only `apiVersion` changes) or `Webhook` (an external converter) | `None` |
| `spec.preserveUnknownFields` | Deprecated switch; `true` stops pruning, `false` is the normal behaviour; use `x-kubernetes-preserve-unknown-fields` in the schema instead | unset: pruning on |

Source: `kubectl explain` output and the [CRD task page](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/). Defaults written in the schema (`default: 1` above) are applied when the object is created or read.

## kubectl

```bash
kubectl apply -f site-crd.yaml
kubectl wait --for=condition=Established crd/sites.example.com --timeout=30s   # the API is ready to use
kubectl get crd                                              # all CRDs
kubectl api-resources --api-group=example.com                # the new resource name, short names, scope
kubectl explain site.spec                                    # field docs come from the schema
kubectl -n crd-demo get sites                                # printer columns
kubectl -n crd-demo get site blog -o yaml
kubectl -n crd-demo patch site blog --type=merge -p '{"spec":{"replicas":3}}'
kubectl get crd sites.example.com -o jsonpath='{.status.storedVersions}'   # versions present in etcd
kubectl delete crd sites.example.com                         # deletes every Site too
```

## How it fails

All rows were reproduced on the test cluster.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `The Site "bad" is invalid: spec.replicas: Invalid value: 50: spec.replicas in body should be less than or equal to 10` and `The Site "bad2" is invalid: spec.image: Required value` | The object breaks the schema (`maximum`, `required`) | Fix the object; to change the rule, edit the CRD schema |
| A typo such as `replica: 3`: `Error from server (BadRequest): ... Site in version "v1" cannot be handled as a Site: strict decoding error: unknown field "spec.replica"`; with `--validate=false` the object is created but `kubectl get site typo2 -o jsonpath='{.spec}'` shows `{"image":"nginx:1.31.8","replicas":1}` | Fields not in the schema are pruned (dropped without error) when strict validation is off | Keep client validation on; declare every field in the schema, or mark a subtree with `x-kubernetes-preserve-unknown-fields: true` |
| `kubectl delete crd sites.example.com`, then `kubectl -n crd-demo get sites` gives `the server could not find the requested resource`; after re-applying the CRD the list is `No resources found` | Deleting the CRD deletes every object of that type | Never delete a CRD in production without a backup (`kubectl get sites -A -o yaml`); remove the objects deliberately first |
| `The CustomResourceDefinition "broken.example.com" is invalid: spec.validation.openAPIV3Schema.properties[spec].type: Required value: must not be empty for specified object fields`; and `metadata.name: Invalid value: "wrongname": must be spec.names.plural+"."+spec.group` | The schema is not structural (every node needs a `type`), or the name does not match plural and group | Add `type:` at each level; name the CRD `<plural>.<group>` |

## Related

- **Cards:** Operators and custom controllers, APIService and aggregation, Objects, spec and status (group 2), Server-side apply and field managers (group 2), API groups, versions and deprecation (group 2).
- **Chapter and lab:** 7.3.
- **Exam:** CKA Cluster Architecture, Installation and Configuration (25%): understand CRDs, install and configure operators; CKAD Application Environment, Configuration and Security (25%): discover and use resources that extend Kubernetes.
