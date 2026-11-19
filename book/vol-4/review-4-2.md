# Review 4.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Name the program at each layer between the kubelet and a container's process, and the interface that joins each pair. Which two of those interfaces are open standards, and who defines them?
2. **Concept.** What does `runc create` do that `runc start` does not? Which state is the container in between them, and why does the runtime spec split the two steps?
3. **Concept.** Restarting containerd did not stop the wallet, but killing its shim did. What is different about the two processes, and what does that tell you about where the supervision lives?
4. **Trace.** A kubelet starts one Pod with one container. List the CRI calls in order, and for each one say which runc command or process it leads to. Mark the calls that only read state.
5. **Trace.** A Pod spec sets `resources.limits.memory: 128Mi`. Follow that number through the kubelet, the CRI, containerd and runc until it is a number in a file on the node. Name the file at the start and the file at the end.
6. **Debug.** A Pod stays in `ContainerCreating`, and its event ends with `OCI runtime create failed: runc create failed: unable to start container process: exec: "sh": executable file not found in $PATH`. Which layer produced the message, what is the most likely cause, and what would you change?
7. **Debug.** After a node's containerd configuration is rewritten by a configuration-management tool, every new Pod on that node fails with `expected cgroupsPath to be of format "slice:prefix:name" for systemd cgroups`. What changed, which two settings do you compare, and how do you confirm the fix without touching a Pod?
8. **Design.** A platform runs (a) the wallet API, (b) a plug-in sandbox that executes customer-written scripts, and (c) a nightly job that reads millions of small files. Choose a runtime for each from runc, gVisor and Kata Containers. Defend each choice with what you measured in Lab 4.2 or with what you would measure, and state what each choice costs.

**Read the diagram.** In the diagram "The shim, not containerd, is the parent of your container" (Ch 4.2, part 1), containerd is stopped for an upgrade. Which boxes keep running? Now the shim box is killed with `kill -9`. Which boxes die, and which box is the parent of `/pause`?

## Hints

| Q | Hint |
| --- | --- |
| 1 | The first diagram of the chapter names five layers; the labels on the arrows are the interfaces. One of them is a gRPC API. |
| 2 | Reread the state diagram in part 2 and the `runc init` line you saw in Lab 4.2 Part B, step 6. |
| 3 | Compare the PPID column in `ps` for the daemon and for the shim, then reread the table in part 3. |
| 4 | Use the sequence diagram. Pull, create and start each change something; list and status calls do not. |
| 5 | The kubelet reads the Pod spec; the runtime spec has a `linux.resources` section; Ch 1.5 and Part B show where cgroup memory limits live. |
| 6 | Read the message from the end: the last part names the real reason. Compare with the distroless failure of Lab 4.1. |
| 7 | Part 4 of the chapter ends with the cgroup driver rule. One setting is in the kubelet's configuration, the other in containerd's. |
| 8 | Use the chart of Lab 4.2: which kind of work slows down under gVisor, and which does not? Which of the three runs code you do not trust? |
| Diagram | Follow the arrows that start at `init (PID 1)`; the dashed line is a request, not a parent link. |
