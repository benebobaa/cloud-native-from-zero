# CNCF Landscape Map

## The map

The real CNCF Landscape lists well over a thousand projects and products; this map shows only the 34 this book teaches, placed on the layer where each one works. It groups projects by what they do, so its six layers differ from the seven layers of the stack map in Ch 0.1, which follows a request from hardware up.

{{diagram landscape-map-01.jsx | landscape map · 34 projects on 6 layers}}

For every new project you meet in your career, ask two questions: which layer does it sit on, and which interface does it implement? Those two answers place it on this map. The full, live landscape is at [landscape.cncf.io](https://landscape.cncf.io/).

## Project index

This book teaches 39 projects: 20 with a hands-on lab step and 19 as comparison cards. The map above draws 34 of them; Kustomize, Distribution, cert-manager, gRPC and CNI appear only in this index. Maturity levels come from [cncf.io/projects](https://www.cncf.io/projects/), checked 2026-11-16; levels change, so check again before you rely on one.

| Project | What it does | CNCF maturity | Interface or role | Chapter | Depth |
| --- | --- | --- | --- | --- | --- |
| etcd | Consistent key-value store | Graduated | Kubernetes's database, uses Raft | 3.2, 5.1 | Lab |
| runc | Starts one container from an OCI bundle | Not CNCF (Open Container Initiative) | OCI runtime spec | 4.2 | Lab |
| containerd | Container runtime | Graduated | CRI | 4.2 | Lab |
| CRI-O | Container runtime built only for Kubernetes | Graduated | CRI | 4.2, 5.5 | Card (4.2); lab targeted, not run (5.5 Part D) |
| gVisor | Sandboxed runtime with a user-space kernel | Not CNCF (Google) | OCI runtime | 4.2 | Lab |
| Kata Containers | Runtime that puts each container in a light VM | Not CNCF (OpenInfra Foundation) | OCI runtime | 4.2 | Card |
| Kubernetes | Container orchestrator | Graduated | — | 5.1 | Lab |
| CoreDNS | Cluster DNS server | Graduated | Service discovery | 2.4, 5.3 | Lab |
| Longhorn | Replicated block storage | Incubating | CSI | 5.4 | Card |
| Rook | Runs Ceph storage on Kubernetes | Graduated | CSI | 5.4 | Card |
| Cilium | eBPF networking, security and observability | Graduated | CNI | 2.5, 6.1 | Lab |
| Calico | Routed networking and network policy | Not CNCF (Tigera) | CNI | 6.1 | Card |
| Flannel | Simple overlay network | Not CNCF | CNI | 6.1 | Card |
| Envoy | L4/L7 proxy | Graduated | Data plane for Gateway API and meshes | 2.4, 6.2 | Card |
| Linkerd | Lightweight service mesh | Graduated | mTLS between services | 6.2 | Lab |
| Istio | Full-featured service mesh | Graduated | mTLS, traffic policy | 6.2 | Card |
| Kyverno | Policy as Kubernetes YAML | Graduated | Admission webhook | 6.3 | Lab |
| Open Policy Agent (Gatekeeper) | Policy in the Rego language | Graduated (Open Policy Agent; Gatekeeper is a sub-entry) | Admission webhook | 6.3 | Card |
| Falco | Runtime threat detection | Graduated | Kernel events via eBPF | 6.3 | Lab |
| Harbor | Container registry with scanning | Graduated | OCI distribution | 4.1, 6.3 | Card |
| cosign | Signs and verifies images | Not CNCF (Sigstore, OpenSSF) | OCI artifacts | 6.3 | Lab |
| Helm | Package manager for Kubernetes | Graduated | Templates and releases | 7.1 | Lab |
| Argo CD | GitOps continuous delivery | Graduated (as Argo) | Controller | 7.1 | Lab |
| Flux | GitOps toolkit | Graduated | Controller | 7.1 | Card |
| Argo Rollouts | Canary and blue-green releases | Graduated (as Argo) | Controller | 7.1 | Card |
| Prometheus | Metrics and alerting | Graduated | Pull-based scraping | 7.2 | Lab |
| OpenTelemetry | Standard for traces, metrics and logs | Graduated | OTLP protocol | 7.2 | Lab |
| Jaeger | Distributed tracing | Graduated | Trace storage and UI | 7.2 | Lab |
| Fluent Bit | Log collector | Graduated (as part of Fluentd) | Log pipeline | 7.2 | Card |
| Thanos | Long-term, global Prometheus | Incubating | Prometheus extension | 7.2 | Card |
| KEDA | Event-driven autoscaling | Graduated | Controller, metrics API | 7.3 | Lab |
| Crossplane | Manages cloud infrastructure as Kubernetes objects | Graduated | Controller | 7.3 | Card |
| Backstage | Developer portal | Incubating | — | 7.3 | Card |
| Gateway API | Next-generation ingress API | Kubernetes SIG project | Kubernetes API | 6.2 | Lab |
| Kustomize | Template-free overlays for Kubernetes YAML | Not CNCF (Kubernetes SIG CLI) | Built into kubectl | 7.1 | Lab |
| Distribution (registry:2) | Image registry server | Sandbox | OCI distribution | 4.1 | Lab |
| cert-manager | Issues and renews certificates in Kubernetes | Graduated | Controller | 2.4 | Card |
| gRPC | RPC framework over HTTP/2 | Incubating | RPC protocol | 2.4 | Card |
| CNI | Plug-in specification for container networking | Incubating | Specification | 2.5 | Card |
