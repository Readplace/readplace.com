# Canary attempt results

Initial results: 24 October 2026. Recovery share uses the run's unique verified recovered articles; this run recovered zero, so shares are `n/a`.

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|
| Presentation extraction | No | Attempt [8275822](https://github.com/Readplace/readplace.com/commit/8275822918e9e386eb8bdcb2f12c5e74fbfa90a7); reverted by [44de272](https://github.com/Readplace/readplace.com/commit/44de272050d9b0e529210f0490e5fa7db751437d) | Production returned challenge content; extraction changes need usable source access first. | n/a |
| Dense summary input | No | Attempt [1b5b438](https://github.com/Readplace/readplace.com/commit/1b5b438618c538d425f5370109ab58abf6a98f35); reverted by [844ce0a](https://github.com/Readplace/readplace.com/commit/844ce0abea2b9d26707f0414da75ad77f0823188) | Request fit, but three provider refusals; context fit alone did not recover the summary, and refusal cause remains unresolved. | n/a |
| Omitted-wrapper page | Yes | [9dbba18](https://github.com/Readplace/readplace.com/commit/9dbba1825174e9845c6f8d6e2df0ed10fb04bd3f), not reverted; the earlier uncommitted attempt was discarded | Fixed by giving a page with no root element one before Readability runs. Production recrawls on 25 October 2026 brought both affected pages to ready with their full text and real titles, and no root-less parse error has been logged since the deploy. Revisit only on a new parse failure from a page with no root element. | n/a; landed outside a canary run |

## 25 October 2026

Snapshot #1244, 91 unresolved articles. This run verified no recoveries, so shares are `n/a`.

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|
| YouTube watch page | No | Attempt [f337234](https://github.com/Readplace/readplace.com/commit/f337234bdc7312357a51de038cbf7b408be8e7e6); reverted by [daa2272](https://github.com/Readplace/readplace.com/commit/daa2272d9be628557b12bf424631310a2d7e13d3) | A parse-time rule built the reader body from the watch page's inline player data, which every local fetch receives. A production recrawl of all eight affected articles ended failed again: each fetch succeeded, but the body was empty and no thumbnail was found, so production fetches receive neither the player data nor `og:image`. Revisit with evidence that production fetches receive the player data, or with a separately evidenced route to the video metadata. | n/a |

## 26 October 2026

Snapshot #1258, 87 unresolved articles. At the operator's request, [fb282b7](https://github.com/Readplace/readplace.com/commit/fb282b75e89b7adffa88042c6f577fc36d221666) stopped reporting YouTube saves; the YouTube row above still holds its revisit condition. This run verified 3 recovered articles, 3.4% of the snapshot.

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|
| Meta-refresh redirect stub | Yes | [24affdd](https://github.com/Readplace/readplace.com/commit/24affdd180548f9d8260706bc5130f14e5fe7afb), not reverted | The origin answered 200 with a textless page whose only way on was a meta refresh, so each save stored an empty page and failed. The crawler now follows one such refresh. Production recrawls on 27 October 2026 brought all three articles to ready on the saved link, with the target's full text: word counts matched the expected parses exactly and the reader showed the body. Two summaries became ready; the third is skipped as too short, like the article's other ready copy. One publisher blocks direct fetches, so that article was compared with production's earlier copy, not the publisher's page. Verification also found two reader gaps that predate the fix: inline videos vanish without a placeholder, and in-page links are dead. Revisit on a stub that needs more than one refresh or a script redirect. | 3 of 3 (100%) |

## 27 October 2026

Snapshot #1271 contains 88 unresolved articles; a local scan with the current source rules found one additional failure, for 89 unresolved articles. This run has verified no recoveries, so shares are `n/a`.

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|
| GitHub PDF viewer | Pending verification | Uncommitted implementation | Production selected a loading shell instead of the document. The viewer's declared download returned a valid PDF locally. A scoped resolver and regression tests pass the full repository check. Deployment and full-document production verification remain pending. Local source access proves no production recovery. | n/a |
