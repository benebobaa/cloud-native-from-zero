# Review 5.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** The Service IP `10.96.206.56` is assigned to no network device on any node. In four sentences, explain how a packet sent to it still reaches a Pod. Name the objects and the programs involved.
2. **Concept.** Each endpoint in an EndpointSlice has three conditions: `ready`, `serving` and `terminating`. What does each one mean, who writes them into the slice, and where does the value come from?
3. **Trace.** The `web` Service now has four ready Pods instead of three. Write the probability on each of the first three `KUBE-SVC` rules and say what the fourth rule contains. Show why each Pod still gets one quarter of the new connections.
4. **Trace.** A Pod in namespace `default` (search list `default.svc.cluster.local svc.cluster.local cluster.local`, `ndots:5`) runs `wget http://api.prod`, and a Service `api` exists in namespace `prod`. List, in order, every name CoreDNS is asked until one succeeds. Then do the same for `payments.example.com`, which the cluster does not know. Treat the A and AAAA pair as one query.
5. **Debug.** `kubectl get svc api` looks normal, but `wget http://api` from another Pod fails at once with "Connection refused". `kubectl get endpointslice -l kubernetes.io/service-name=api` shows `<unset>` under ENDPOINTS, and all `api` Pods are `Running` and `1/1`. Name the two most likely causes, the command that proves each, and the comment you expect to find on the `KUBE-SERVICES` rule on the node.
6. **Debug.** A developer changes `LOG_LEVEL` in a ConfigMap from `info` to `debug`. Ten minutes later the Pods still log at `info`, yet `cat /etc/app/app.properties` inside a Pod shows the new file content. Explain both observations and give two ways to make the new value take effect in a Deployment.
7. **Design.** For the wallet API, decide for `POSTGRES_DB`, `POLL_SECONDS` and `POSTGRES_PASSWORD`: ConfigMap or Secret, and environment variable or file. Say how you would make a ConfigMap change roll out to the Pods, and name one protection for the password that goes beyond creating a Secret object.
8. **Design.** After a release every Pod is slow when it calls `api.partner.example.com`, and the CoreDNS query log shows several lookups per call. Explain the cause with evidence from this chapter. Give three fixes at three levels (the name, the Pod, the cluster) and one cost of each.

**Read the diagram.** (9) The picture shows Service `api`, its EndpointSlice and the `KUBE-SVC` chain that kube-proxy wrote from it. Answer from the picture alone: (a) Which Pod receives no new connections, and which field says so? (b) Out of 600 new connections, how many do you expect for each Pod, and about how far from that can one run stray? (c) What does `kubectl get pods` show in the READY column for that Pod? (d) A fifth Pod becomes ready. Which numbers and rules in the picture change?

{{diagram review-5-3-01.jsx | Review 5.3 Q9 · a Service, its EndpointSlice and its KUBE-SVC chain (exercise values)}}

## Hints

| Q | Hint |
| --- | --- |
| 1 | Follow the packet-path diagram: which rule matches, which rewrites, who remembers the choice. |
| 2 | Re-read the EndpointSlice section: the docs' own definitions, and the diagram of who watches and writes what. |
| 3 | Each rule matches a fraction of what the earlier rules left over. The last rule takes the rest. |
| 4 | `ndots` counts the dots in the name. Compare with the CoreDNS log in the DNS section. |
| 5 | The Service compares labels, not readiness. Check what the selector asks for and where the Pods are. Then read the "has no endpoints" paragraph. |
| 6 | One of the two paths is copied once, when the container starts. The other is refreshed by the kubelet, but your program must read it again. |
| 7 | What does the chapter say about base64? Think about which settings you would be happy to see in `kubectl get -o yaml`. |
| 8 | Use the DNS latency chart of Lab 5.3 Part D. Look at the trailing dot, `spec.dnsConfig`, and the NodeLocal DNSCache row of the Going deeper table. |
| 9 | Read the slice first, then the chain. Compare the Pods in the slice with the destinations in the chain. Use the same leftover-fraction idea as Q3. |
