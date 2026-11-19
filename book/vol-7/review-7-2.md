# Review 7.2

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** Name the three signals. For each, say which question it answers best and how its data leaves the Pod (pulled, pushed, or read from a file).
2. **Concept.** A counter only goes up. Why is `rate(wallet_api_requests_total[1m])` more useful than the raw counter, and what happens to the result when a wallet Pod restarts and its counter drops back to zero?
3. **Concept.** Explain SLI, SLO and error budget to a product manager, using the wallet as the example. Why is a target of 100% a bad SLO?
4. **Trace.** A service has an SLO of 99.95% over 28 days. (a) How many minutes of total outage does the budget allow? (b) A bug makes 2% of requests fail. What is the burn rate, and how long until the budget is gone? (c) Would the Workbook thresholds page a human? Show every step.
5. **Trace.** Five spans arrive at the backend. Draw the tree of the trace that contains `GET /orders`, say which span is its root, and name the span that belongs to a different request.

   | span\_id | parent\_id | trace\_id | name |
   | --- | --- | --- | --- |
   | s1 | none | t9 | GET /orders |
   | s2 | s1 | t9 | SELECT orders |
   | s3 | s1 | t9 | POST /payments |
   | s4 | s3 | t9 | INSERT payments |
   | s5 | none | t4 | GET /orders |
6. **Debug.** After a release, Prometheus's memory climbs for hours until the Pod is OOMKilled. The release added a label `user_id` to a request counter. Explain the mechanism, and give two fixes.
7. **Debug.** During a database outage the wallet dashboard shows an error ratio near 0, yet users report that transfers hang. Using what you know about how the wallet counts errors, give two reasons, and say how you would measure it better.
8. **Design.** Design the reliability plan for the wallet's transfer path. Choose two SLIs, set an SLO for each with a window, compute the budget of one, decide which burn rates page and which open a ticket, and say what the code must emit to measure the second SLI. Then say what you will do when the budget runs out.

**Read the diagram.** In the error budget picture of this chapter, the box "Page: 6x for 6 h" says it spends 5% of the budget. Show the arithmetic that gives 5%. Then change the SLO from 99.9% to 99.5%: which numbers in the picture change, and which stay the same?

## Hints

| Q | Hint |
| --- | --- |
| 1 | Re-read the "three roads out of the Pod" picture and its table. |
| 2 | A counter has no meaning without a time window; read what `rate()` and `increase()` adjust for. |
| 3 | Think of a sentence a user would say, an agreed number, and the remainder you may spend. Then ask what a perfect target costs. |
| 4 | Budget = window in minutes x (1 - SLO). Burn rate = error ratio / (1 - SLO). Compare with the three rows in the thresholds picture. |
| 5 | A trace is one `trace_id`. Children name their parent with `parent_id`. |
| 6 | Every distinct combination of label values is one time series. How many users are there? Where should a user ID live instead? |
| 7 | Read the "Be honest about what this SLI misses" paragraph. What does a hung request add to the error counter? |
| 8 | Start from what the user feels. Use the worked example for the arithmetic, and the incident picture for what happens after the alert. |
| Diagram | The 5% does not depend on the SLO, only on the window. Which boxes contain minutes or the SLO itself? |
