# 10 · Extending Kubernetes

Kubernetes is extended by adding new API types: a CustomResourceDefinition for the common case, an aggregated API server for the rare one, and a controller to make either do something.

{{diagram g10-extending-kubernetes-01.jsx | Extension points · CRD, APIService, operator}}

Read the middle box as the one API the user sees; the arrows show where each kind of object really lives.

| Card | Role | Chapter | Exam |
| --- | --- | --- | --- |
| CustomResourceDefinition | Add a type served by the API server | 7.3 | CKA Cluster Architecture (CRDs and operators); CKAD Environment, Configuration and Security (CRDs, operators) |
| APIService and aggregation | Delegate a group and version to another server | 7.3 | Not named in the curricula; metrics-server is the example you meet |
| Operators and custom controllers | Act on custom resources | 7.3 | CKA Cluster Architecture (install and configure operators); KCNA Cloud Native Architecture |
