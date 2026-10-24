# Canary attempt results

Initial results: 24 October 2026. Recovery share uses the run's unique verified recovered articles; this run recovered zero, so shares are `n/a`.

| Category | Fix retained | Commit(s) | Verified outcome | Recovery share |
|---|---|---|---|---|
| Presentation extraction | No | Attempt [8275822](https://github.com/Readplace/readplace.com/commit/8275822918e9e386eb8bdcb2f12c5e74fbfa90a7); reverted by [44de272](https://github.com/Readplace/readplace.com/commit/44de272050d9b0e529210f0490e5fa7db751437d) | Production returned challenge content; extraction changes need usable source access first. | n/a |
| Dense summary input | No | Attempt [1b5b438](https://github.com/Readplace/readplace.com/commit/1b5b438618c538d425f5370109ab58abf6a98f35); reverted by [844ce0a](https://github.com/Readplace/readplace.com/commit/844ce0abea2b9d26707f0414da75ad77f0823188) | Request fit, but three provider refusals; context fit alone did not recover the summary, and refusal cause remains unresolved. | n/a |
| Omitted-wrapper page | No | None; uncommitted changes removed, no revert commit | Scoped extraction passed local checks; runner contention prevented deployment, so production behavior remains unverified. | n/a |
