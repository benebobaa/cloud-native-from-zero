# Review 6.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Gateway API splits one Ingress object into three resources. Name them, say who owns each, and say which one a developer edits to add a new URL path.
2. **Concept.** The Kubernetes project says the Ingress API "has been frozen". List two things that statement does *not* mean, and one thing it does mean for a team choosing a new edge setup.
3. **Concept.** An HTTPRoute sends 90 to `wallet-api` and 10 to `wallet-api-canary`. Are these percentages? What does the Gateway API guide say weights mean, and what split do you get with weights 9 and 1?
4. **Trace.** A new Pod joins the `wallet-api` Service. Trace, using the Envoy pipeline diagram, which part of Envoy's configuration changes and which API (LDS, RDS, CDS, EDS or SDS) carries it. Does Envoy restart?
5. **Trace.** Linkerd's proxy injector is an admission webhook. You label a namespace for injection and the running Pods still show `1/1` containers. Explain why, and give the command that fixes it.
6. **Debug.** After meshing the wallet, `wallet-api` can no longer reach `postgres`, but a manual `psql` from a non-meshed Pod works. List three causes you would check, using the limits of mTLS in the Linkerd docs.
7. **Debug.** Linkerd's certificates "expire after 24 hours and are automatically rotated". A cluster's clocks drift by 30 minutes on one node. What symptom could you see, and which certificate fields explain it?
8. **Design.** A team asks for a mesh "because we need encryption". Give two questions you ask before agreeing, and one cheaper alternative to a mesh for encrypting only the wallet-to-database connection.

**Read the diagram.** In the sidecar versus ambient diagram, the sidecar half has a proxy in every Pod and the ambient half has one `ztunnel` per node. If the wallet runs 3 `wallet-api` Pods and 1 `postgres` Pod on 2 nodes, how many proxies run in each mode, and which Pod would need a waypoint in ambient mode for a rule that matches the URL path?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the roles diagram; the route is the one the application team owns. |
| 2 | The Ingress docs say GA, no removal planned, and no further changes. |
| 3 | Weights are "a proportional split of traffic (rather than percentage)": share = weight divided by the sum. |
| 4 | EDS carries the endpoints of a cluster; no restart is involved. |
| 5 | Injection happens when a Pod is created. |
| 6 | Skip ports, opaque ports, and non-meshed traffic are listed as limits of automatic mTLS. |
| 7 | A certificate is only valid between its `notBefore` and `notAfter` times. |
| 8 | What is the threat, and who must prove identity to whom? Think of TLS to Postgres itself. |
| Diagram | Count proxies per Pod in one mode and per node in the other; L7 features need a waypoint. |
