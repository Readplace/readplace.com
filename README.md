# Readplace

A read-it-later app. Save articles, read them later. Built from a personal reading system I've been running for 10 years.

→ [readplace.com](https://readplace.com)

Solo-built, with Claude as a working agent in the pipeline.

---

## How it works

### Hypermedia all the way down

One URL space serves two clients. Browsers get HTML; the browser extension gets Siren over the same routes via content negotiation. The extension only knows the entry point — every subsequent step is discovered through server-published action names (`save-article`, `search`, `delete`) and link rels. URLs and HTTP methods are not part of the contract, so renaming a route is a server-internal change and the extension keeps working without a redeploy.

### SSR with the URL as state

Pages render on the server. Every interaction is a plain form submit or link navigation that works with zero client-side JavaScript; `hx-boost` adds an SPA-like feel on top without owning state. GETs are side-effect-free; mutations follow POST-Redirect-GET. There is no React, no client-side state library, and no parallel JSON API serving the same data — the URL is the state, and the server's HTML response is the truth.

### Async work is Command → System → Event

A request emits a Command. A handler runs it and publishes one or more Events. EventBridge routes them; an SQS queue with a dead-letter queue sits in front of every Lambda; DynamoDB holds the state machine. Independent consumers subscribe to events without the publisher knowing they exist, which means new behaviours (crawl, summarise, notify) plug in without touching the code that produced the event.

### Deliberately boring infrastructure

Pulumi over AWS managed services — Lambda, DynamoDB, EventBridge, S3, CloudFront. No Kubernetes, no ORMs, no custom orchestration. Dependencies are wired explicitly at the composition root for each entry point; nothing silently falls back to an in-memory store or a no-op logger. After maintaining [js-cookie](https://github.com/js-cookie/js-cookie) for 10+ years (22B+ annual npm downloads), I've learned that the best stack is the one that doesn't need babysitting.

The codebase has strong opinions on testing, typing, branded IDs, and comments that document **why** rather than **what** — [CLAUDE.md](./CLAUDE.md) has the detail, written for AI agents but reads as a human contributor's guide.

---

## AI in the loop

Claude reviews every PR, fixes CI failures, resolves merge conflicts, and applies high-priority review comments — all from GitHub Actions, on every push. You can also `@claude` in any issue or PR comment to get a response that's allowed to commit. One secret (`ANTHROPIC_API_KEY`) bootstraps the pipeline.

The full setup — pipeline diagram, workflow inventory, design principles — lives in [AI_WORKFLOWS.md](./AI_WORKFLOWS.md).

---

## Development

```bash
pnpm install
```

`pnpm check` runs lint, type-checking, unit and integration tests, Playwright E2E, and a 100% coverage gate. Run `pnpm run` to see every task. An optional devbox manifest at the repo root pins the toolchain (Node, pnpm, AWS CLI, Pulumi) if you'd rather not install them yourself.

---

## Questions

Open an issue.
