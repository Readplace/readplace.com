# Canary attempt results

Initial results: 24 October 2026. Recovery share uses the run's unique verified recovered articles; this run recovered zero, so shares are `n/a`.

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|
| Presentation extraction | No | Attempt [8275822](https://github.com/Readplace/readplace.com/commit/8275822918e9e386eb8bdcb2f12c5e74fbfa90a7); reverted by [44de272](https://github.com/Readplace/readplace.com/commit/44de272050d9b0e529210f0490e5fa7db751437d) | Production returned challenge content; extraction changes need usable source access first. | n/a |
| Dense summary input | No | Attempt [1b5b438](https://github.com/Readplace/readplace.com/commit/1b5b438618c538d425f5370109ab58abf6a98f35); reverted by [844ce0a](https://github.com/Readplace/readplace.com/commit/844ce0abea2b9d26707f0414da75ad77f0823188) | Request fit, but three provider refusals; context fit alone did not recover the summary, and refusal cause remains unresolved. | n/a |
| Omitted-wrapper page | Yes | [9dbba18](https://github.com/Readplace/readplace.com/commit/9dbba1825174e9845c6f8d6e2df0ed10fb04bd3f), not reverted; the earlier uncommitted attempt was discarded | Fixed by giving a page with no root element one before Readability runs. Production recrawls on 25 October 2026 brought both affected pages to ready with their full text and real titles, and no root-less parse error has been logged since the deploy. Revisit only on a new parse failure from a page with no root element. | n/a; landed outside a canary run |
