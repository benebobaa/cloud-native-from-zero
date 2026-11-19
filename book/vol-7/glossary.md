# Glossary & References

## Glossary

Terms are grouped by chapter. A term is defined where this volume first uses it.

### Ch 7.1 · Helm and GitOps

| Term | Meaning |
| --- | --- |
| Chart | A Helm package: templates plus default values and a version |
| Release | One named installation of a chart in a namespace |
| Revision | The numbered state of a release; every install, upgrade and rollback makes a new one |
| Values | The settings a user passes to a chart (`values.yaml`, `-f`, `--set`) |
| Kustomize | A tool that builds YAML by applying patches and transformers to a plain base; built into kubectl |
| Base, overlay | The shared YAML, and a folder of changes laid over it for one environment |
| Patch | A small edit to a manifest: JSON Patch (`op`, `path`, `value`) or a strategic-merge fragment |
| GitOps | Operating a system by keeping its desired state in git and letting an agent reconcile the system to it |
| Desired state, live state | What git says should exist; what the cluster actually runs |
| Drift | A difference between desired and live state, usually from a manual change |
| Reconcile | Compare desired with live state and act on the difference, repeatedly |
| Application (Argo CD) | A custom resource that binds a repository path and revision to a cluster namespace |
| Sync status | `Synced` or `OutOfSync`: does live state equal git? |
| Health status | `Healthy`, `Progressing`, `Degraded` and others: is what runs working? |
| Auto-sync, self-heal, prune | Apply git changes automatically; revert manual changes; delete objects removed from git |
| Progressive delivery | Releasing a new version to a growing share of traffic, with checks between steps |
| Canary, blue-green | Send a small share of traffic to the new version; or run old and new side by side and switch |

### Ch 7.2 · Observability and SRE

| Term | Meaning |
| --- | --- |
| Observability | How well you can understand a system's inner state from its outputs: metrics, logs and traces |
| Metric | A number sampled over time, such as requests per second |
| Log | A timestamped record of one event |
| Trace, span | The path of one request through a system; a span is one timed step in it |
| Scrape | Prometheus fetching `/metrics` from a target on a schedule |
| PromQL | Prometheus's query language, for example `rate(x_total[1m])` |
| Label, cardinality | A key and value that splits a metric into series; the number of distinct series |
| OTLP | The OpenTelemetry protocol for sending traces, metrics and logs |
| Instrumentation | Code that produces telemetry, written by hand or added by a library |
| SLI | Service level indicator: a measured ratio of good events to all events |
| SLO | Service level objective: the target for an SLI over a period, such as 99.9% over 30 days |
| SLA | Service level agreement: an SLO with consequences written into a contract |
| Error budget | The allowed failures: 1 minus the SLO, over the period (99.9% over 30 days = 43.2 minutes) |
| Burn rate | How fast the budget is used: error ratio divided by (1 minus the SLO); 1 means exactly on budget |
| Postmortem (blameless) | A written review of an incident that looks for causes in the system, not in people |
| MTTD, MTTR | Mean time to detect, and to restore; in this volume measured for one incident |

### Ch 7.3 · Operators and Platforms

| Term | Meaning |
| --- | --- |
| CRD | CustomResourceDefinition: teaches the API server a new resource type |
| Custom resource | An object of a type defined by a CRD |
| Controller | A loop that watches objects and makes the world match their spec |
| Operator | A controller plus a CRD that encodes how to run one piece of software |
| Status subresource | A separate endpoint for `status`, so a controller can write it without touching `spec` |
| Finalizer | A marker that blocks deletion until a controller has cleaned up |
| Owner reference | A link that makes the garbage collector delete a child with its owner |
| KEDA, ScaledObject | Event-driven autoscaler, and the custom resource that connects a workload to a trigger such as a queue length |
| Crossplane, Composition | Control plane that provisions infrastructure through Kubernetes APIs; a recipe that turns one claim into many managed resources |
| Platform engineering, golden path | Building internal products for developers; the paved, supported way to do a common task |
| Backstage | A developer portal framework with a software catalog and templates |
| Chaos test | Deliberately breaking part of a running system to check that the team and the design cope |

## References

Every link below returned HTTP 200 when checked on 2026-11-17; maturity levels are as listed on [cncf.io/projects](https://www.cncf.io/projects/) on 2026-11-16.

### Ch 7.1 · Helm and GitOps

| Source | Use it for |
| --- | --- |
| [Helm: charts](https://helm.sh/docs/topics/charts/) and [chart best practices](https://helm.sh/docs/chart_best_practices/) | Chart layout, template functions, hooks, dependencies, CRDs |
| [Helm: install](https://helm.sh/docs/intro/install/) | Installing the `helm` CLI |
| [Kubernetes docs: manage objects with Kustomize](https://kubernetes.io/docs/tasks/manage-kubernetes-objects/kustomization/) | Bases, overlays, patches, generators |
| [OpenGitOps principles v1.0.0](https://opengitops.dev/) | The four principles of GitOps |
| [Argo CD: architecture](https://argo-cd.readthedocs.io/en/stable/operator-manual/architecture/) and [automated sync](https://argo-cd.readthedocs.io/en/stable/user-guide/auto_sync/) | Components; auto-sync, self-heal, prune |
| [Argo CD: sync options](https://argo-cd.readthedocs.io/en/stable/user-guide/sync-options/) and [diffing](https://argo-cd.readthedocs.io/en/stable/user-guide/diffing/) | `Prune=false`, `CreateNamespace`, `ignoreDifferences` |
| [Argo CD: webhook](https://argo-cd.readthedocs.io/en/stable/operator-manual/webhook/) and [cluster bootstrapping](https://argo-cd.readthedocs.io/en/stable/operator-manual/cluster-bootstrapping/) | The 3-minute poll; app-of-apps |
| [Argo CD install manifest v3.6.1](https://raw.githubusercontent.com/argoproj/argo-cd/v3.6.1/manifests/install.yaml) | The file Lab 7.1 applies |
| [Flux: concepts](https://fluxcd.io/flux/concepts/) and [components](https://fluxcd.io/flux/components/) | The alternative GitOps toolkit |
| [Argo Rollouts](https://argo-rollouts.readthedocs.io/en/stable/) | Canary and blue-green releases |
| [CKA and CKAD curricula](https://github.com/cncf/curriculum) | Helm and Kustomize as exam topics |
| [Security chapter, Vol 6 Ch 6.3](https://benelabs.tech/cloud-native-from-zero/vol-6/ch-6-3.html) | Why a Secret is only base64, and the tools that keep it out of git |

### Ch 7.2 · Observability and SRE

| Source | Use it for |
| --- | --- |
| [SRE book: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) | SLI, SLO, SLA |
| [SRE Workbook: Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) | Burn rates and the 14.4, 6, 1 thresholds |
| [SRE Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/) | Error budget policy |
| [SRE book: Postmortem Culture](https://sre.google/sre-book/postmortem-culture/) and [example postmortem](https://sre.google/sre-book/example-postmortem/) | The blameless postmortem and its template |
| [Prometheus: data model](https://prometheus.io/docs/concepts/data_model/), [metric types](https://prometheus.io/docs/concepts/metric_types/), [alerting practices](https://prometheus.io/docs/practices/alerting/) | Series, labels, counters, what to alert on |
| [Prometheus community Helm charts](https://prometheus-community.github.io/helm-charts) | The chart Lab 7.2 installs |
| [OpenTelemetry: traces](https://opentelemetry.io/docs/concepts/signals/traces/), [context propagation](https://opentelemetry.io/docs/concepts/context-propagation/), [sampling](https://opentelemetry.io/docs/concepts/sampling/), [OTLP](https://opentelemetry.io/docs/specs/otlp/) | Spans, `traceparent`, wire protocol and ports |
| [W3C Trace Context](https://www.w3.org/TR/trace-context/) | The `traceparent` header |
| [Jaeger architecture](https://www.jaegertracing.io/docs/latest/architecture/) | Jaeger v2 and all-in-one mode |
| [Kubernetes: logging architecture](https://kubernetes.io/docs/concepts/cluster-administration/logging/), [Fluent Bit data pipeline](https://docs.fluentbit.io/manual/concepts/data-pipeline), [Thanos](https://thanos.io/tip/thanos/getting-started.md/) | Projects described but not run |

### Ch 7.3 · Operators and Platforms

| Source | Use it for |
| --- | --- |
| [Operator pattern](https://kubernetes.io/docs/concepts/extend-kubernetes/operator/), [Controllers](https://kubernetes.io/docs/concepts/architecture/controller/) | Definitions |
| [Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/), [CRD task](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definitions/), [CRD versioning](https://kubernetes.io/docs/tasks/extend-kubernetes/custom-resources/custom-resource-definition-versioning/) | Schemas, pruning, subresources, versions |
| [Finalizers](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/), [garbage collection](https://kubernetes.io/docs/concepts/architecture/garbage-collection/) | Deletion order |
| [Writing controllers](https://github.com/kubernetes/community/blob/master/contributors/devel/sig-api-machinery/controllers.md), [Kubebuilder book](https://book.kubebuilder.io/), [Kopf](https://kopf.readthedocs.io/) | Going beyond a 60-line operator |
| [Kubernetes Python client](https://github.com/kubernetes-client/python) | The library `operator.py` uses (version 37.0.2 in the lab) |
| [HPA](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/), [KEDA PostgreSQL scaler](https://keda.sh/docs/2.21/scalers/postgresql/), [ScaledObject spec](https://keda.sh/docs/2.21/reference/scaledobject-spec/) | The scaling formula and every KEDA field used |
| [KEDA Helm charts](https://kedacore.github.io/charts) | The chart Lab 7.3 installs |
| [Crossplane: What's new in v2](https://docs.crossplane.io/latest/whats-new/) | Compositions without claims |
| [Helm and CRDs](https://helm.sh/docs/chart_best_practices/custom_resource_definitions/) | The `crds/` folder |
| [CNCF Platforms white paper](https://tag-app-delivery.cncf.io/whitepapers/platforms/) and [Platform Engineering Maturity Model](https://tag-app-delivery.cncf.io/whitepapers/platform-eng-maturity-model/) | What a platform is, and how to judge one |
| [Backstage](https://backstage.io/) | The developer portal |

See also the [CNCF landscape data](https://github.com/cncf/landscape/blob/master/landscape.yml) for the maturity levels on every project card.

## Versions tested

Test machine: Ubuntu 26.04 on WSL2 with Docker Desktop, 2026-11-17. "Tested" means the lab commands were run against the version shown.

| Tool | Version | Status | Used in |
| --- | --- | --- | --- |
| Kubernetes (kind node image) | 1.37.0 (`kindest/node:v1.37.0`) | tested | all labs |
| kind | v0.33.0 | tested | all labs |
| kubectl, with Kustomize | 1.37.1, Kustomize v5.8.1 | tested | all labs |
| Helm | v4.3.1 | tested | Labs 7.1, 7.2, 7.3 |
| git | 2.53.0 | tested | Lab 7.1 |
| Argo CD | v3.6.1 | tested | Lab 7.1 |
| Postgres | 17 | tested | all labs |
| Prometheus chart and server | `prometheus-community/prometheus` 29.47.2, Prometheus v3.16.0 | tested | Lab 7.2 |
| Grafana | 13.3.1 | tested | Lab 7.2 |
| Jaeger | 2.23.0 | tested | Lab 7.2 |
| OpenTelemetry Python | `opentelemetry-sdk` 1.45.2, `opentelemetry-exporter-otlp-proto-http` 1.45.2, `opentelemetry-instrumentation-psycopg` 0.66b2 | tested | Lab 7.2 |
| KEDA | chart and app 2.21.0 | tested | Lab 7.3 |
| Kubernetes Python client | 37.0.2 | tested | Lab 7.3 |
| Python | 3.12 in images, 3.14 on the test laptop | tested | Labs 7.2, 7.3 |
| Alertmanager, Fluent Bit, Thanos, Flux, Argo Rollouts, ApplicationSet, Crossplane, Backstage, Sealed Secrets, External Secrets, SOPS | not pinned | described only, from project documentation | Ch 7.1 to 7.3 |
| Ubuntu 24.04 LTS | target | not run: the labs ran on 26.04; commands avoid distribution-specific behaviour except `python3-venv` and `pip` (Lab 7.3) | all labs |
