# Review 4.1

## Questions

Answer without notes first. Answer keys are in the Instructor Companion.

1. **Concept.** What is the difference between a tag and a digest? Why does the Kubernetes documentation advise deploying by digest?
2. **Concept.** What does a layer contain, and what does it not contain? Why can two different images share one layer, and who stores it only once?
3. **Concept.** A Dockerfile copies `secrets.txt` in one step and runs `rm secrets.txt` in the next. Explain why the file is still in the image. Which two things can see it?
4. **Trace.** A node holds every layer of `wallet:v1` except the last one, and now pulls `wallet:v2`, which has the same first seven layers and a new last layer. List the HTTP requests the client sends, in order, and mark each one it can skip.
5. **Trace.** A Dockerfile does `COPY . /app` and then `RUN pip install -r requirements.txt`. You change one line of code and rebuild. Which steps run again, and why? Rewrite the order so that only one step runs.
6. **Debug.** A Pod stays in `ImagePullBackOff` for `registry.example.com/wallet:v3`. Name three different causes and, for each, the first thing you would look at.
7. **Debug.** Two nodes ran different code last night from the same tag, `wallet:prod`, and nobody redeployed. Explain how that happens and give two ways to prevent it.
8. **Design.** Choose a base image for each service and defend it with size, debuggability and compatibility: (a) the wallet API, (b) a service whose Python package ships only glibc wheels and needs a compiler to build, (c) a service the security team wants to run with no shell inside.

**Read the diagram.** In the diagram "The wallet's 3 KB of code rides on 51.6 MB of someone else's layers" (Ch 4.1, part 1), you change one line in `api.py` and rebuild. Which boxes get a new digest, and which keep their old one? Does the tag `wallet:v1` move by itself?

## Hints

| Q | Hint |
| --- | --- |
| 1 | One of them can be moved to point at other content. Reread the Kubernetes quotation in part 4. |
| 2 | Look at what the manifest lists, and at what a layer's `tar -tzf` shows in Lab 4.1 Part A. |
| 3 | Reread "A delete is a hiding, not a removal" and the Break it of Lab 4.1. |
| 4 | Use the pull-sequence diagram: the tag is read once, then everything is by digest. |
| 5 | Cache rule: once a layer changes, all layers after it are rebuilt. See the build-cache diagram. |
| 6 | Name, credentials, network, rate limit. Which of them can you tell apart from the Pod's events? |
| 7 | Who moved the tag, and which node still held the old copy? |
| 8 | Compare the three rows of the base-image table in part 5; (b) needs the build tools only while building. |
| Diagram | Start at the layer you changed and move toward the tag; list every file whose bytes change. |
