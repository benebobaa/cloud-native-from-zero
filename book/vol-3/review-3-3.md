# Review 3.3

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Explain "imperative" and "declarative" with the wallet workers as the example. In Kubernetes terms, which part of an object is the declaration and which part is written by the system? Why does applying a declaration twice differ from running a command twice?
2. **Concept.** Define *level-triggered* and *edge-triggered* control. Give one event a controller can lose, and show how each style behaves after losing it. Why do real controllers still watch for events if the level is enough?
3. **Concept.** Which properties of the wallet worker make it safe for a loop to kill and replace it at any moment? Name the two Twelve-Factor rules and the database feature involved.
4. **Trace.** Desired is 3 and three workers run. A reconcile pass runs every 2 s and acts instantly. At t = 0.5 you set desired to 5; at t = 1 one worker crashes; at t = 3 you set desired to 2. Passes run at t = 0, 2, 4. For each pass write want, have, the action, and the fleet size afterwards.
5. **Trace.** Two copies of the controller, A and B, both run with `--events`. A worker dies, and both are woken by the same event. Starting a container takes 1.5 s. Describe what each copy observes and does, how many workers exist 2 s later, and what the next two passes do. Is the system stable?
6. **Debug.** After a restart, a controller deletes every healthy worker. Its log shows `want=0 have=3`. Give two different ways the goal can have become 0, and say what a safer controller does instead. Then the opposite case: the log shows `want=3 have=0` although three workers are running. What went wrong on the observe side, and what does it cost?
7. **Debug.** A poll-only controller repairs a killed worker in about 10 s; the same controller with `--events` usually repairs it in about 2 s. One night Docker's event stream drops, and repairs go back to about 10 s but never stop happening. Explain both facts. What would you alert on?
8. **Design.** You run two copies of the controller with a lease in etcd: TTL 15 s, renewed every 2 s. The leader is cut off from etcd by a partition but its workers keep running. Say when the old leader must stop acting, when the other copy can start acting, and whether the two can overlap. What can you add so that an old leader's late commands do no harm?

**Read the diagram.** In the "one reconcile pass" diagram of this chapter: (a) which steps talk to an outside system, and to which? (b) If etcd stops answering, which step cannot run, and what does the loop use instead? (c) Step 3 is highlighted. Why is it the only step that decides, and why does the arrow return to step 1 and not to step 4?

## Hints

| Q | Hint |
| --- | --- |
| 1 | A command names an action; a goal names a result. Kubernetes objects have two nested fields. |
| 2 | Replay the lost "worker died" event through each style. Then reread the chapter's last paragraph of part 4: what does a watch buy you? |
| 3 | Factors VI and IX, and `FOR UPDATE SKIP LOCKED`. Ask what a dead worker leaves behind. |
| 4 | A pass looks at the world only when it runs. The crash at t = 1 and the change at t = 0.5 are both visible by t = 2. |
| 5 | Both read have = 2 before either container exists. Count starts, then count what each copy sees afterwards. |
| 6 | Look at what the code does when the key is absent, and when the value is a typo. For the second case: is "docker ps printed nothing" the same as "no workers"? |
| 7 | One mechanism is an optimisation, the other is the guarantee. Which one did the lab measure with and without? |
| 8 | Compare the lease TTL with how long the old leader needs to notice that its renewal failed. Think of fencing tokens from Chapter 3.1. |
| Diagram | Follow the arrows to the boxes at the left and the bottom. Ask what the loop did before it had a value in step 1. |
