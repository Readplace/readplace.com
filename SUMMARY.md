# Saving a link: what the performance work did, and where to go next

Written 2026-08-01, against `6b2fdb0d`. This is a working document for whoever
picks up save performance next. It records what the save path costs today, how it
got there, what was deliberately *not* done, and what a performance test would
have to look like to be worth having.

Read [CLAUDE.md](./CLAUDE.md) first — in particular **Evidence Over Speculation**.
It is the reason several plausible-sounding optimisations below are listed as
"not done" rather than "todo": a guard for a problem nobody has observed does not
belong in the tree, and that includes performance guards.

---

## The problem, as observed

A save felt slow. Measured in the Chrome service worker's network panel against a
queue of twelve pages, one click produced **pages 1–12 fetched twice**, bracketing
a `POST` that itself took 201ms. The POST was never the problem.

Three separate things were paying for a save:

1. **The server crawled the origin inside the request.** If the article already
   existed and its content was older than the stale TTL, accepting the save ran a
   full origin fetch, a readability parse and an S3 write before responding.
2. **The client fetched the reader's whole queue to find one action.** The Siren
   walker eagerly followed every advertised `next` link and collected all pages
   before returning — and a save walks twice (once to discover the save action,
   once when the deferred upload runs).
3. **The client blocked on capturing and uploading the page** before it would say
   "Saved", then asked the server to re-derive a state it had just been told.

---

## What the save costs now

Roughly, on a warm cache:

| Operation | Requests |
|---|---|
| Save (toolbar, context menu, or shortcut) | entry-point walk (304-able) + the `save-article` POST |
| Deferred content upload, when the queue wakes | entry-point walk + the `save-content` POST |
| Open the popup to browse | one collection page |
| Click "next" past the loaded prefix | exactly one more page |
| Tab activation / URL change (toolbar icon) | entry-point walk + the advertised `search` |
| Mark read / delete | the mutation only (icon re-derived only if the article *is* the active tab) |

**A save issues zero collection GETs.** That is the invariant most worth
protecting — it is the one that regressed silently before, and the one the
request-budget tests now pin.

Server side, accepting a save is now: `resolveCanonicalIdentity` → `findArticleByUrl`
→ `findArticleCrawlStatus`, then either a stale-check publish (existing, settled
article) or the write path — `saveArticle`, `markCrawlPending`, `markSummaryPending`,
then three post-write effects in parallel, then `LinkQueued`. See
`src/packages/save-article/src/{submit-freshness,save-article-from-url}.ts`.
No origin fetch, no parse, no S3 write.

---

## How it got there

Six commits, oldest first. Each was reviewed and independently green before the
next was cut.

| Commit | What it did |
|---|---|
| `perf(@packages/save-article,hutch,save-link)` | Stopped the accept phase crawling inline. Hutch's prod composition swapped the crawling `initRefreshArticleIfStale` for the non-crawling `initSubmitFreshness`; the entire inline crawl stack it existed to feed (`extractPdf`, `siteRules`, `crawlArticle`, `parseHtml`, the refresh-html publisher, the `@packages/refresh-article-content` dependency) went with it. Dev and e2e keep the inline implementation. |
| `4abbc454` | Added the persisted upload queue and `uploadContent` to `browser-extension-core` as **library code with nothing wired to it** — both extensions kept their inline save in that commit. |
| `2e0b69a6` | Made an expired access token refresh-and-replay instead of signing the reader out. A prerequisite, not a nicety: deferring the upload makes "token expired since the save" the normal case. Also removed the queue's own duplicate refresh — with the fetch layer refreshing, a second one would spend a rotating refresh token twice. |
| `52e83a94` | Chrome saves the link first; capture and upload move to the queue, woken by an alarm. |
| `6bcc7786` | Firefox does the same (MV2's persistent page uses a timer, not an alarm — no new permission), and every piece of transitional scaffolding is deleted. |
| `6b2fdb0d` | Lazy pagination, the one-call save, and the server-authored saved view. |

The full pre-slicing implementation is still in `git stash` (`stash@{1}`
"instant-save: full implementation", `stash@{0}` iOS + pagination). Diffing a
stash against what shipped is the fastest way to see what was cut and why.

---

## Deliberately not done

Do not re-add these without evidence. Each was written, reviewed, and removed.

- **A recent-accept grace on the server freshness check.** Fully written and
  tested, then dropped: no client sent two POSTs for one save at the time, *and*
  it was broken — it anchored on `savedAt`, which every re-save bumps, so the
  stuck-crawl self-heal it promised could never fire.
- **A `MAX_PERSISTED_BYTES` cap and an over-cap "one unpersisted attempt" branch**
  in the upload queue. A whole alternate code path for a quota refusal nobody has
  seen.
- **A 24h job TTL.** The backoff table sums to ~16.4h across the seven retries
  before `MAX_ATTEMPTS` fires, so the TTL was unreachable for any job actually
  being retried.
- **A per-job try/catch with `rearm()` in a `finally`.** Added for a hypothetical
  `QuotaExceededError`; removing it also removed a hot-retry-loop bug that only
  existed *because* of it.
- **Treating an S3 presigned-PUT 403 as transient.** A guard for an expired
  signature nobody has observed.
- **An iOS orphan sweep and an explicit `timeoutIntervalForResource`.** Staged
  bodies live in `Library/Caches` (OS-reclaimable) and are deleted on completion;
  the timeout was setting the OS default anyway.
- **The `check-url` pre-flight** and the "Already in your list" / "Removed" popup
  views. Deleted on purpose: a re-save is an upsert, which is what the website's
  save bar has always done. `findByUrl` survives for the toolbar icon.

---

## Still unoptimised

Honest list, roughly by value.

1. **The toolbar-icon check fires on every tab activation and every tab URL
   change** — two requests each (entry walk + the advertised `search`). Flipping
   through tabs fills the network panel. The entry walk is ETag-cached so warm
   hits are 304s, but it is still two round trips per tab switch. This predates
   all of the above.
2. **The popup filter box searches only loaded items.** Before lazy pagination it
   searched everything, because everything was always fetched. The server already
   advertises a `search` action (the icon check uses it); routing the filter input
   to it would restore whole-queue search *and* stay within the contract. This is
   a known accepted trade-off, not an oversight.
3. **The deferred upload re-walks the entry point** at job-run time. Deliberate —
   a job outlives the worker that queued it, and any href or presigned slot URL it
   could have carried would have expired. Avoiding it means persisting hrefs,
   which the hypermedia contract forbids.
4. **Two-phase saves emit save-intent analytics twice**, under different `path`
   values (`saveArticle`, then `saveContent`). Not corrupt — the paths
   distinguish them — but a query summing all paths double-counts. Which phase
   owns "saved" is undecided.
5. **Dev and e2e still run the inline-crawling freshness**, so production takes a
   path the e2e suite never exercises, and the `refreshed` verdict branch is dead
   in prod.

---

## Performance tests

### What exists now

`initSirenReadingList request budget` in
`projects/browser-extensions/browser-extension-core/src/reading-list/siren-reading-list.test.ts`
asserts the **exact recorded request list** for two journeys:

- a save spends one entry-point walk and the POST, and never reads the queue
- browsing reads one page, and a second only when asked for another

These were verified non-vacuous by mutation: making `getItems` eagerly follow one
more page failed 4 tests. They use `createRoutingFetch`, a fetch fake in the same
file that records every call as `"METHOD url"`, so they need no new
infrastructure and run in the normal unit suite.

### What else exists to build on

- **Selenium + `node:test`** drives the extension e2e flows
  (`projects/browser-extensions/*/src/e2e/*/run.e2e-local.main.ts`), against a
  real hutch e2e server. Flows are built from `FlowAction` maps and run by
  `FlowRunner`. See `.claude/skills/e2e-testing/SKILL.md`.
- **Playwright + `toHaveScreenshot`** is how *hutch* does visual regression
  (`src/packages/e2e-harness`, `captureCheckpoint`, per-platform baseline PNGs).
  The extension projects do **not** use Playwright.

### Recommended next

1. **Extend the request budget** to the remaining journeys: the deferred upload,
   a tab-activation icon check, and a mutation. Same fake, same shape.
2. **An e2e request-count assertion.** The Selenium flows drive a real server;
   counting requests server-side (or via CDP in the Chrome flow) would catch
   wiring regressions the unit fakes cannot see.
3. **Duration budgets — with care.** Wall-clock assertions on a contended CI box
   are how you get a flaky suite; this repo already sees Selenium flows fail under
   parallel load and pass in isolation. If you want timing, measure *request
   count* and *payload bytes* instead: they are deterministic and they are what
   actually regressed.

### On visual tests

The popup's saved view was regressed *by this work* and restored: server-authored
copy briefly rendered through the generic message-box style instead of the view's
own typography (a title, then a light-gray subtitle). It is now pinned
structurally by `browser-extension-core/src/popup/saved-view.test.ts` — first
message becomes the title, the rest become subtitles, and an unrenderable media
type is ignored rather than injected.

A true **pixel** regression test for the popup would need Playwright loading the
unpacked extension (`--load-extension` in a persistent context) plus per-platform
baselines, mirroring what hutch already does. That is real new infrastructure for
the extension projects and has not been built. The structural test catches the
class of regression that actually happened; a pixel test would additionally catch
CSS drift.

---

## Contract constraints you must not break

From `.claude/skills/hypermedia-api-design/SKILL.md` — read it before optimising
anything on the wire:

- The client knows **one** URL, the entry point. Everything else is discovered.
  "Just skip the walk and POST straight to the collection" is not available.
- **Never persist an href**, a presigned URL, or a pagination continuation. This
  is why the deferred upload re-walks.
- Pagination follows the server's opaque `next` link. Never build `?page=`.
- Structural rels (`self`/`next`/`prev`/`root`/`item`) are the client's own
  navigation, never user controls.
- Server-authored message bodies are trusted HTML, injected as HTML. The server
  escapes; the client never sanitises.
- The save response carries what to tell the reader and where they may go next.
  The client renders it and does **not** fetch the collection to find out what
  happened.
