# Review 3.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Why can a client never tell "the server is dead" from "the server is slow"? Name two other situations that look the same from the client's side.
2. **Concept.** State the three CAP properties as Gilbert and Lynch define them. Why is "pick two of three" misleading for a system that runs on a real network?
3. **Concept.** What does PACELC add that CAP leaves out? Give one system for PA/EL and one for PC/EC and say why each fits.
4. **Trace.** Process P1 has a Lamport counter of 1 and sends a message, so the message carries 2. P2 has counter 1 and receives it. What is the receive event's timestamp? P2 then sends a message to P3, whose counter is 7. What is P3's counter after receiving it? Finally: from timestamps alone, can you tell that P2's first event (timestamp 1) happened before P1's send (timestamp 2)? Explain.
5. **Trace.** In Lab 3.1 Part B, 50 ms of added delay turned a 9 ms request into 313 ms. Suppose the wallet needed three sequential database messages per request instead of six. What request time do you expect with the same added delay, and what does this say about batching messages?
6. **Debug.** A payment service retries a charge when it gets no reply within 2 seconds, and some customers are charged twice. Using the four-row silence diagram, say which rows can cause this and give two different fixes.
7. **Debug.** A node flips between `Ready` and `NotReady` every few minutes, though its CPU is idle and it never reboots. Which failure model from this chapter fits? Name two things you would measure before changing any timeout.
8. **Design.** The wallet's database is replicated across two data centres and the link between them drops for 40 minutes. For "transfer money" and for "show my balance", choose PC or PA behaviour and justify each choice using the GitHub incident. What would you do about writes accepted on both sides?

**Read the diagram.** In the Lamport-clock diagram (Part 3 of this chapter), list every event that is concurrent with event c. Which of them has a timestamp higher than c's? What does your answer show about the rule "if C(x) < C(y) then x happened before y"?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the four rows of the silence diagram; the client sees the same thing in each. |
| 2 | Write each definition as one sentence, then check the word "every" in the availability definition. |
| 3 | PACELC has a second half that applies when nothing is broken. Use the grid diagram. |
| 4 | On receive: max of both counters, plus 1. Then look for a message path from one event to the other. |
| 5 | Delay is paid once per sequential send. Compute the delay per message from the six-message case. |
| 6 | Rows 3 and 4: the server acted. Think of the wallet's transfer `id`. |
| 7 | Is the node dead, or are its heartbeats late? The first is crash, the second is timing. |
| 8 | Each side kept accepting writes: which two properties does that give up and keep? Think about how to merge or reject later. |
| Diagram | Find a message path (arrows plus process lines) from c to each event, and from each event to c. No path either way means concurrent. |
