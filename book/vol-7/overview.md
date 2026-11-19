# Cloud Native from Zero · Vol 7: Platform and Capstone

Volume 7 takes three weeks. It teaches how real teams ship, observe and extend Kubernetes, and ends with the capstone.

## Outcomes

After three weeks of chapters and the capstone you can ship the wallet from git, watch it, explain how reliable it is in numbers, and extend Kubernetes with your own controller.

1. Package the wallet as a Helm chart and as Kustomize overlays, and choose between the two for a given job.
2. Deploy the wallet from a git repository with Argo CD, tell *Synced* from *Healthy*, and roll back with `git revert`.
3. Scrape the wallet's `/metrics` with Prometheus, draw it in Grafana, and write the PromQL for a service level indicator.
4. Set a service level objective, compute the error budget and the burn rate, and write an alert that fires on fast burn.
5. Follow one request across the API and the database as a trace in Jaeger, and describe what code change made it visible.
6. Autoscale the worker from the size of the transfer backlog with KEDA.
7. Explain CRDs and controllers, and write a small operator that turns a custom resource into a real wallet account.
8. Run an incident and write a blameless postmortem in the capstone.

This volume also covers the CKA and CKAD 1.37 topics Helm, Kustomize, CRDs and operators.

## Chapter map

Each chapter adds one layer around the wallet you built in earlier volumes; the capstone asks you to put all three layers together and then survive an incident.

{{diagram overview-01.jsx | Vol 7 chapter map · 3 chapters, 1 capstone}}

## Prerequisites

You need Vol 5 and Vol 6 finished, and the wallet image from Vol 4 built.

| You must be able to | From | Used here for |
| --- | --- | --- |
| Write and apply a Deployment, a StatefulSet, a Service and a Secret; read `kubectl describe` and logs | Vol 5 | Every lab |
| Explain RBAC (Role, RoleBinding, ServiceAccount) and why a Secret is only base64 | Vol 5, Vol 6 Ch 6.3 | Lab 7.1 (where the password lives), Lab 7.3 (operator permissions) |
| Explain NetworkPolicy, `securityContext` and resource limits | Vol 6 Ch 6.3 | Capstone Part 3 |
| Build the wallet image and load it into kind | Vol 4 | `wallet:v1`, and two images built in this volume |
| Explain idempotence and reconciliation | Vol 3 | Ch 7.3 |
| Run `git init`, `add`, `commit`, `push`, `revert` | Ch 7.1 primer table | Lab 7.1 |

## How to run the labs on an 8 GB laptop

- Run one lab at a time. Delete the kind cluster at the end of each lab (`kind delete cluster --name cnlab`); the labs do not depend on each other's cluster state.
- Lab 7.1 installs Argo CD (about 1 GB of memory when idle), Lab 7.2 adds Prometheus, Grafana and Jaeger, Lab 7.3 adds KEDA. Do not install them all in one cluster.
- Each lab needs a few hundred megabytes of images. Pull them on a good network before the lecture.
- On Docker Desktop, `kind load docker-image` can fail with a content-digest error. The labs then use `docker save` and `kind load image-archive`; each lab says which method it used.

## Versions

The Kubernetes baseline is 1.37 (kind node `kindest/node:v1.37.0`, kubectl 1.37.1) on Ubuntu 24.04 LTS. Every tool in this volume is pinned in the "Versions tested" line of its lab and collected in the last table of the Glossary and References tab. A tool listed there as "tested" was run on the test machine (Ubuntu 26.04 on WSL2 with Docker Desktop); "targeted" means the version is named but a step was not run.
