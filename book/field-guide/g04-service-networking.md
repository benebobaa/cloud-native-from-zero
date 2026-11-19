# 4 · Service networking

## How the cards fit together

{{diagram g04-service-networking-01.jsx | group 4 · how the cards relate}}
Read left to right: a Client Pod looks up a name, the Service gives a stable IP, EndpointSlices track which Pods are ready, and NetworkPolicy filters traffic to them.

## Cards and where they are taught

| Card | Covers | Chapter | Exam domain |
| --- | --- | --- | --- |
| Service | ClusterIP, NodePort, LoadBalancer, headless | Ch 5.3 | CKA and CKAD: Services and Networking (20%) |
| EndpointSlice | ready Pod addresses behind a Service | Ch 5.3 | CKA: Services and Networking, endpoints |
| Endpoints (deprecated) | the legacy list, selectorless Services | Ch 5.3 | CKA: Services and Networking, endpoints |
| ServiceCIDR and IPAddress | where ClusterIPs come from | Ch 5.3 | not named in the CKA or CKAD curriculum |
| Ingress and IngressClass | HTTP routing through a controller | Ch 6.2 | CKA and CKAD: Services and Networking |
| Gateway API | GatewayClass, Gateway, HTTPRoute | Ch 6.2 | CKA: Services and Networking |
| NetworkPolicy | allow and deny rules for Pod traffic | Ch 6.1 | CKA and CKAD: Services and Networking |
| DNS for Services and Pods | CoreDNS names, search path | Ch 5.3, Ch 6.1 | CKA: Services and Networking (CoreDNS), Troubleshooting (30%) |

All eight also belong to the KCNA domain Container Orchestration (28%). Chapter numbers come from the coverage matrix on the How to use tab.
