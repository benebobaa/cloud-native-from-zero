# Review 6.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Name the three components involved when a Pod starts and its network is set up, and say in one sentence what each does. Which of them reads the files in `/etc/cni/net.d/`?
2. **Concept.** In Ch 2.5 you plugged one end of a veth pair into a Linux bridge. On a Cilium node you found no bridge. Where do the packets of a local Pod go instead, and which kernel feature makes the decisions the bridge used to make?
3. **Concept.** Your network team will not run BGP and will not add routes for Pod ranges. Which cross-node design can you use, what does it add to every packet, and what does that do to the MTU a Pod can use?
4. **Trace.** A Pod calls `http://wallet-api/accounts/alice` with `kubeProxyReplacement=true` and no kube-proxy. List, in order, the steps from the application's `connect()` to the backend Pod's address, and name the kernel hook and data structure involved.
5. **Trace.** Right after you apply a default-deny policy to the wallet namespace, `wallet-api` can no longer reach `postgres`, even though `postgres-from-wallet` allows it. Hubble shows the first drop on the *client* side. Which direction of which Pod is blocked, and what is missing?
6. **Debug.** After `kind create cluster` with the default CNI disabled, `kubectl get nodes` shows `NotReady` and CoreDNS is `Pending`. Give the first three commands you run and what each output would tell you.
7. **Debug.** A policy says:

   ```yaml
   ingress:
   - from:
     - namespaceSelector: {matchLabels: {team: payments}}
     - podSelector: {matchLabels: {app: wallet-api}}
   ```

   A Pod labelled `app: batch-job` in a namespace labelled `team: payments` can reach the database. Why, and how do you rewrite the rule so only `wallet-api` Pods in `payments`-team namespaces may connect?
8. **Design.** You must choose a CNI for 300 nodes that need NetworkPolicy, Hubble-style visibility and no kube-proxy. Compare Cilium and Calico on three points you would check before deciding, and say which you would test first and why.

**Read the diagram.** In the NetworkPolicy diagram of Ch 6.1, three arrows are solid and one is dashed. Write the names of the policies the `wallet` namespace needs so that exactly the three solid paths work. Which solid arrow needs more than one rule, and what extra egress rule does every Pod need?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the CNI sequence diagram: the kubelet speaks CRI, not CNI. |
| 2 | Look at what the lab showed on the node: `lxc...` interfaces, routes and eBPF programs on the interface. |
| 3 | Compare the two panels of the overlay diagram; count the extra header bytes in the Cilium routing docs. |
| 4 | Socket-LB acts when `connect()` is called, before any packet exists. |
| 5 | A connection needs the source's egress policy *and* the destination's ingress policy to allow it. |
| 6 | `kubectl describe node` shows the Ready condition's message; `/etc/cni/net.d` on the node shows whether a config exists. |
| 7 | Count the dashes under `from`: one entry with two selectors is AND; two entries are OR. |
| 8 | Check enforcement features, datapath options, observability, kernel requirements and who on your team already knows each. |
| Diagram | Three allow rules for the paths, one for DNS, one default deny; one path crosses two Pods' policies. |
