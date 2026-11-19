# Review 0.1

## Questions

Answer without notes first, then check against the chapter. Answer keys are in the Instructor Companion.

1. **Concept.** In three sentences, explain to a friend outside computer science what problem Kubernetes solves. Do not use the words container, cluster or cloud.
2. **Concept.** What is the difference between a virtual machine and a container? Name one thing each shares with its host and one thing it does not.
3. **Concept.** What does "declare the desired state" mean? Give an example from everyday life where something keeps comparing what is with what should be, and corrects it.
4. **Trace.** Using the stack map, list every layer a request from `curl` to `wallet-api` passes through when the wallet runs on Kubernetes.
5. **Trace.** In Lab 0.1 you ran `kind create cluster`. Which layers of the stack did that one command use? Which layer is "fake", and why does that not matter for learning?
6. **Design.** Your team must choose a network plug-in. One option is CNCF graduated, the other is a sandbox project with a feature you want. What questions would you ask before choosing the sandbox project?
7. **Design.** Why does Kubernetes define interfaces (CRI, CNI, CSI) instead of building its own runtime, network and storage? Give one benefit and one cost.

**Read the diagram.** On the stack map in Ch 0.1, name the layer where each of these lives: the kubelet, runc, an iptables rule, Argo CD, an ext4 filesystem, the wallet's Postgres table.

## Hints

Use a hint only after ten honest minutes on the question.

| Q | Hint |
| --- | --- |
| 1 | Start from the four problems in "The problem": failing machines, changing load, daily releases, growing systems. |
| 2 | Think about the kernel. How many kernels run on a host with five VMs? With five containers? |
| 3 | A thermostat. What does it measure, what is the target, what does it do about the difference? |
| 4 | Go top to bottom through the stack map; the network plug-in and the kernel's network stack both matter. |
| 5 | Run `docker ps` while the cluster runs. What is underneath each "node"? |
| 6 | Look at CNCF's description of each maturity level. Think about who fixes a security bug at 2 a.m. |
| 7 | Benefit: think about Cilium vs Calico. Cost: think about how many moving parts you must now understand and debug. |
