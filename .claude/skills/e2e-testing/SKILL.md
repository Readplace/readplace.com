---
name: e2e-testing
description: E2E testing conventions using Playwright and the HATEOAS-based test framework. Use when working with E2E tests, files in e2e/ directories, *.e2e*.ts files, when changing a CI job or runner script that captures, compares or reviews screenshots, visual baselines or transition frames, or when test errors mention Playwright, the HATEOAS test client, its navigation handler, page actions, or locator timeouts.
---

# E2E Testing Guidelines

Conventions for writing and debugging E2E tests using the project's HATEOAS-based Playwright test framework.

## Architecture

State machine-based test runner where tests provide data and the runner automatically discovers and executes available actions.

For implementation details, see the HATEOAS runner — the E2E support module whose navigation loop fails with `flow is stuck` when no action is available; grep for that string — and any local spec in the same project that imports that runner.

## Selector Strategy

- **NEVER hook visual labels to E2E tests** - query by `name` or `id` attributes instead
- Prefer `page.locator('input[name="fieldName"]')` over `page.getByLabel('Field Label')`
- Use `data-test-*` attributes only for elements without semantic attributes

## Identify Pages by Body Class, Not URL

Do not hook into URLs to detect page navigation. URLs are implementation details.

```typescript
// BAD - Hooks into URL structure
await page.waitForURL('**/passengers**');

// GOOD - Hooks into page identifier class
await page.waitForSelector('body.page-passengers');
```

## Action Availability Detection

**CRITICAL**: A page action's availability predicate MUST use element-based detection, NOT URL path checks.

Use `assert` (from `node:assert/strict`) inside the predicate to verify element state. This ensures the check line is properly covered by test instrumentation. The surrounding `try/catch` converts assertion failures into `false` returns.

```typescript
// FORBIDDEN
canRun: async page => {
  if (page.url().includes('/flights')) return false
}

// REQUIRED - Element-based with assert
canRun: async page => {
  try {
    const element = page.locator('#unique-element-id')
    const count = await element.count()
    assert.ok(count > 0, 'element should exist')
    return true
  } catch {
    return false
  }
}
```

## Page Reload After Form Submissions

Form submissions and link clicks may cause full page reloads or HTMX AJAX swaps. Use the shared click-and-wait helper, which handles both: it races Playwright's `load` event against htmx's in-flight marker appearing and then leaving the DOM — grep the E2E support code for `.htmx-request`.

Without this, `waitForLoadState('domcontentloaded')` may resolve immediately before navigation starts.

## Prefer Self-Contained Test Data

Keep test data inline within each E2E test flow rather than extracting to shared fixtures.

## Determinism and Hermeticity

Every flake root-caused in the main web app's 20x-soak investigation was an uncontrolled input reaching a test: live CDN fetches, host network state, and waits on "quiet" proxies instead of the asserted condition. These rules bind new E2E and UI code; the referenced implementations are canonical.

| Rule | Why (observed failure) |
|------|------------------------|
| Local suites import `test` from the hermetic fixture — the shared E2E harness module that answers third-party asset requests from pinned local files instead of the network; grep for `hostname === "fonts.googleapis.com"` — never `@playwright/test` directly. Any asset a shared template loads from a third-party host gets pinned into the fixture directory that module reads **in the same change** — page tests inherit template dependencies invisibly. | Font-fetch races under 9-worker load rendered a shrink-to-fit element 1px narrower (45% of runs) and hung `document.fonts.ready` to the 120s timeout. |
| Pin the closure of an asset set: every file the pinned CSS can reference must exist in the fixtures, including fallback formats. | Chromium requests the `.ttf` fallback when a woff2 fetch aborts mid-navigation; `route.fulfill` on a missing file kills the test. |
| Wait for the condition the next line asserts — never `networkidle`, bare `document.fonts.ready`, or timeouts. See the harness's brand-font wait (the one that polls `document.fonts` per family — grep for `document.fonts.forEach`) and the terminal body-class asserts in the readlist flow's view-page actions (the ones that `expect` the destination's `body.page-…` class `toHaveCount(1)` right after the click). | Both proxies failed in both directions: resolved before the guarded state existed, and hung after the terminal state was reached. |
| After an async mutation, poll until its effect is visible before re-reading dependent state. See the delete-all cleanup loops in the readlist flow's actions — the two that `expect.poll` the delete-button count below its previous value before re-reading it (grep the readlist flow for `toBeLessThan(before)`). | Re-counting delete buttons before the htmx swap landed clicked a button the swap was removing — a 120s hang on the last item. |
| Host state is a test input: suppress timer-, clock-, and `navigator.onLine`-driven UI before pixel capture, and give any new such UI a deterministic opt-out. See the settle helper in the banner-nav visual suite — the one that `remove()`s every volatile-chrome selector not kept under test, then asserts the nav sits below the banner; grep that suite for `?.remove()`. | A Wi-Fi drop rendered the offline banner into 14 consecutive captures (+38px). |
| Prefer numeric geometry assertions over screenshots; screenshot only metric-stable surfaces (fixed dimensions, settled fonts). See the header-height test in the Article history visual suite (grep the E2E sources for `header height is`). | A 1px font-metric shift hard-fails `toHaveScreenshot` on size before any diff threshold applies. |
| Regenerate snapshot baselines under the exact gate conditions: `HEADLESS=true`, hermetic fixtures, and the renderer the gate uses — the pinned browsers on a Linux host, the pinned Playwright container anywhere else (the project's `update-visual-baselines` target does all three for the spec paths passed to it; see [Regenerating Baselines](#regenerating-baselines)). | Baselines captured against live-CDN font bytes failed 20/20 on CI once rendering became deterministic. |
| Regenerate only the specs a change touches: pass the specs `pnpm check` names to `update-visual-baselines`, in small batches, never the whole suite. | Commit c3362c1c2 regenerated every spec and committed 56 PNGs in one batch, too many for any of them to be reviewed. |
| Open every regenerated whole-page baseline at full size and judge it against the design. A size diff, a thumbnail or a passing geometry test is not a review. | The new desktop reader baseline in c3362c1c2 showed the card pinned left of an empty 340px band; it was accepted, and the off-centre layout shipped. |
| Assert the page-level geometry a layout promises: centring, shared edges, and every page that renders a shared layout get numeric assertions, not only element captures. | Every desktop test of the public reader was an element capture, so none of them could see that the card sat off-centre. |
| One renderer owns every baseline: a checkpoint has exactly one committed PNG, captured and verified in the pinned Playwright container. A host that is not already Linux renders through that container instead of against its own fonts — so a baseline is never named after, or compared on, the machine that happened to record it. | A second `-darwin` set that no CI job verified drifted from the Mac that recorded it: 107 checkpoints failed the pre-commit hook the same day they were refreshed, and the hook was routinely bypassed with `--no-verify`. |
| A flake fix is proven by a 20x uncached `pnpm check` soak, not one green run. One mechanism-backed fix per observed failure; if the same failure recurs after the fix, revert it instead of patching on top. | The 45%-rate flake passed single pre-commit runs repeatedly; misattributed fixes survived single retests and fell to soaks. |
| A browser suite runs alone on the machine: the nx target that launches Playwright carries `"parallelism": false` (grep the project.json files for it) and every local Playwright config pins `workers: 2`. A new suite inherits both. | 21 of 97 `web-tests` runs on main failed between 2026-09-28 and 2026-10-07 with no pixel diff anywhere: `toHaveScreenshot` timed out "waiting for element to be stable" (a starved renderer delivering no animation frames for 5 s), `browserContext.newPage` timed out at 120 s, and 10 s jest budgets blew, every time while a browser suite overlapped the main app's 13 jest shards and another browser suite on the shared runner. On 2026-10-11 a local pre-commit run of the main app overlapped two other pre-commit checks and attempt 1 of a CI run on the self-hosted runner, which is an OrbStack VM on the same Mac: the local run took 2.5× CI's time per test and hit seven latent races at once, and that CI attempt failed three of the same signatures and passed on rerun. The local gate counts as one of the overlapping suites. |
| An element capture of a top-layer popover includes the scrim outside its rounded corners, so a translucent or blurred backdrop makes those corners a function of the page's scroll position and of whatever the page did after the last click. Before opening the popover, wait for the page beneath to reach its final height — the e-ink delete-dialog test waits for the deferred offline-download control the readlist reveals after login. | The e-ink delete-dialog captures failed with 51 (light) and 44–85 (dark) differing pixels, every one inside the four corner squares, with a byte-identical interior: a click that beat the +44px reveal above the first card scrolled the page to 513 instead of the baseline's 557. Ten baseline re-recordings in twelve days had changed only those corners. |
| The shared click-and-wait helper waits for the current document's `load` before arming its `load` race (`waitForLoadState('load')` returns at once when it has already fired). A DOM-presence wait resolves while hermetic fonts and deferred scripts are still being fulfilled, and that late `load` resolves the helper before the swap it was meant to cover. | The e-ink readlist-switcher test toggled a `<details>` that an in-flight `HX-Location` swap then replaced closed, and polled 5s for an `open` attribute nobody would set again. Holding the woff2 fetch 1.2s reproduced it 6/6; the wait passed 6/6 under the same hold. |
| An e2e server the Playwright request API talks to never closes idle keep-alive sockets on its own timer (`keepAliveTimeout = 0` on the listening server — grep the E2E sources for it). Playwright pools one keep-alive agent per worker process with no idle timeout and reuses its sockets across tests and contexts, so the server's idle close is the only party that can race a reuse, and the request API does not retry. | One request in 1578 — the first POST of a test — left 5999ms after the previous response, exactly on Node's 5s + 1s idle close, and failed with `socket hang up`. A probe that waited 6.015s before reusing the socket reproduced it; with the timer off, 6/6 reuses answered. |
| Settle a forced interaction state on the element's `getAnimations()` reporting no unfinished animation (grep the contrast audit for it), never on two identical consecutive reads. A transition that no rendering frame has started reads its rest value for as long as the renderer is starved, so two reads 100ms apart agree exactly in the case the loop exists to exclude. | The focus-ring and toolbar-hover contrast audits reported the rest border (1.26:1) and an unchanged hover fill in a starved run. A forced 60s `transition-delay` reproduces both messages verbatim; with the animation wait the same forcing fails loudly on the poll timeout instead. |
| A visual checkpoint's target must not sit inside the swap set of a live htmx poll: a settled slot is not re-sent on another slot's tick (the poll response builder omits the reader slot once the reader has settled on the article; its tests pin that). | The hostile-markup reader capture grew one row (1903px, 12479 differing pixels) or lost its locator (`Element is not attached to the DOM`) whenever the pending-summary poll's 3s tick re-sent the settled reader slot between the sub-pixel snap and the last screenshot. |
| A fixture that must land a crawl in its `failed` state answers a status the pipeline settles in-process — `404`/`410` (`not-found`) or a block-class status (`blocked`; the crawler's persona-fallback module lists the block status codes) — never a `5xx`. A `5xx` is a retriable fetch: the save-link worker and the comprehensive crawl handler rethrow it, so the row stays `pending` until SQS dead-letters the message and the DLQ handler settles it, a wait bounded by the queue's visibility timeout set in the save-link stack's infrastructure. Only the synchronous in-memory pipeline hides this locally. | The staging crawl-fails leg waited its full 180s on "Generating clean reader view" for a `500` fixture the local run had settled instantly through the in-memory store's crawl-failed transition (CI run 33287875827). |

## Regenerating Baselines

A screenshot mismatch that the change under work intends is fixed by regenerating its baseline, not by loosening the check. This applies to a CI-fix or review-fix agent run as much as to a person.

### Which renderer, and why a missing Docker is not a blocker

| Host | Renderer the updater uses | What it needs |
|------|---------------------------|---------------|
| Prepared Linux CI job (the Claude listener, the web-test jobs) | Native, against the pinned browsers from the browser image: the self-hosted runner's own image carries them, and a hosted runner materialises them along with the image's fonts. Either way `PLAYWRIGHT_BROWSERS_PATH` is set, and the web-test job that verifies the baseline is routed to the same kind of runner — grep the workflows for `fromJSON('["self-hosted", "orbstack"]')`: the listener's and the web-test job's `runs-on` are the two hits. They pick that label by different tests — the listener by the PR author's `author_association` (OWNER, MEMBER or COLLABORATOR), the web-test job by the head repo (`head.repo.fork == false`) — so the renderer matches only for a same-repo PR by an OWNER, MEMBER or COLLABORATOR author | Nothing more. The updater skips its own browser download when browsers are supplied, so the baseline is rendered by the same bytes the gate compares with |
| Linux without supplied browsers (a fresh developer clone) | Native, after the updater installs Chromium | Nothing more |
| Not Linux (a Mac) | The pinned Playwright container | Docker running, because a host renderer would drift from the one the gate uses |

An authoring session that has no Docker (a remote sandbox, for example) shows nothing about CI: the prepared Linux job never uses the container. Report an environment failure only when the updater itself fails, and quote its error.

### Procedure

1. Confirm that the failing screenshot is a change the PR intends. Read the commit history and the diff the failure points at. A mismatch nobody intended is a defect: fix the code and leave the baseline alone.
2. Find the target: `pnpm nx show projects --with-target update-visual-baselines` lists the projects that have one. Use the project that owns the failing spec.
3. Pass only the failing specs, by path relative to that project, following the small-batch rule in the table above: `pnpm nx run <project>:update-visual-baselines -- <spec> [<spec> …]`. With no paths the updater regenerates every visual spec.
4. Open every regenerated PNG at full size and judge it against the design and the PR's intent. A defect it shows (clipping, overlap, an off-centre layout, a missing font) is fixed in the code, followed by another regeneration, never by accepting the image.
5. Verify with E2E enabled. `CLAUDE_CODE_REMOTE` must be unset so the run renders and compares the new baselines (see [Coverage for E2E Test Support Code](#coverage-for-e2e-test-support-code)). A cached or E2E-skipped green proves nothing.
6. Commit the source change and its regenerated baselines together, so no commit carries one without the other.
7. In the PR comment, report the specs regenerated, the command run, what the images showed, the verification result, and the verbatim error of any environment step that failed.

## Coverage for E2E Test Support Code

E2E test support files (each project's E2E source tree — the `testDir` the shared Playwright-config factory sets; the perf-measurement config that bypasses the factory sets the same directory itself) are **not excluded** from coverage enforcement. They run under c8 during `pnpm check` and must meet the same thresholds as production code.

The single exception is `CLAUDE_CODE_REMOTE=true`, which makes the phase runner's E2E-skip predicate (in its default dependencies) skip every `e2e: true` phase and, because those files then never execute, also excludes the E2E tree from the thresholds (in the shared coverage-enforcement config at the repo root). Grep for `CLAUDE_CODE_REMOTE`: the hits are that predicate and its tests, that config, the nx hash inputs below, and the perf scripts whose comments explain why they stay outside the phase runner so the flag cannot skip them. Set it only where a browser genuinely cannot run — it buys a green that verifies strictly less, and the coverage gate cannot backstop it, because the same flag removes the E2E tree from the threshold set and a skipped run still reports 100%.

The variable is an nx hash input on `test`, `test-with-coverage` and `check` (in [nx.json](../../../nx.json), and repeated in each extension's `project.json`, whose `inputs` array shadows the target default rather than merging with it). That keeps the skipped run and the full run in separate cache entries, so a green produced with E2E skipped can never replay as a green for a run that needs them.

For `c8 ignore` rules, allowed cases, and V8 coverage quirks, see the [Code Coverage section in CLAUDE.md](../../../CLAUDE.md#code-coverage).

## Running E2E Tests

E2E tests run as part of `pnpm check` via the shared test-phase runner package (`pnpm nx show projects` lists it). Each project has a phase config declaring its phases (Jest unit, Jest integration, Playwright, `node:test` — each project picks what it needs; `git grep -l "projectName:" -- "*.js"` lists them) and a thin coverage entry script — the one its `test-with-coverage` script runs under c8; `pnpm run` in the project's directory shows it — that allocates a free port via the runner's free-port helper, assigns it to `E2E_PORT`, and delegates to the runner. `pnpm test:e2e` runs just the Playwright phase directly for local iteration.

### Staging e2e

Only projects with a `deploy-infra` target have a staging e2e config. After the reusable project-deployment workflow (grep the GitHub workflows for `:post-deploy`) deploys to staging, it runs the project's `post-deploy` target, which reads the deployed URL from `pulumi stack output` and runs `STAGING_URL=$URL pnpm test:e2e:staging`. Results land in the staging Playwright config's `outputDir` and the workflow uploads that directory as a GitHub Actions artifact.

The staging Playwright config sets `webServer: undefined` (Playwright is pointed at a remote instance, not launching one) and uses a longer timeout and one retry.

### Why a repo-owned phase runner, not `@nx/playwright`

The repo invokes raw Playwright CLI through the shared phase runner rather than adopting the `@nx/playwright` plugin. The runner already sequences phases across Jest, `node:test`, and Playwright — extensions need all three — and the dynamic port + `NODE_V8_COVERAGE` discipline lives outside Playwright entirely (in each project's coverage entry script and its Playwright config). Adding the Nx plugin would overlap that orchestration without replacing it.

## Never Reuse an Existing Server — Every Run Gets a Fresh One on a Fresh Port

Playwright's `reuseExistingServer: true` is forbidden. If a stale dev server or a previous test run is still bound to the same port, Playwright silently connects to it and runs against the wrong instance. The failures look like real regressions and the passes are worse — tests that pass against the wrong state. The shared Playwright-config factory (the harness function every Playwright config but the perf-measurement one passes its options through — that one opts out for the reasons its header comment gives; grep for `reuseExistingServer: false`) hard-codes that value for every config it produces.

That setting alone is not enough. It only makes Playwright check the port *before* it spawns the server; a foreign listener that takes the port during the server's boot window is still adopted by the readiness poll, and the suite runs green against it. So the readiness URL carries a per-run nonce that only the server this run launched is told — a foreign listener 404s and the run fails instead of lying. The factory owns both halves (it mints the nonce, builds the probe URL, and passes it to the server it spawns), which is why a `webServer` block has no `url` to hardcode.

Anything that starts an e2e server **outside** Playwright — the extension suites spawn `hutch:e2e-server` themselves — must mint its own nonce, pass it as `E2E_READY_NONCE`, and poll `/e2e/ready/<nonce>` (both come from the harness module that defines the `E2E_READY_NONCE` variable name and builds the `/e2e/ready/<nonce>` path — grep for either; import them, don't restate them). The servers read that variable as a required environment variable, so one started without it fails at boot rather than serving an unguarded readiness route.

Pair that with a dynamically allocated port so a hardcoded number can't collide with a running dev server: the coverage entry script asks the runner for a free port and exports it as `E2E_PORT` before it loads the phase config or runs any phase — read the script (`pnpm run` in the project's directory shows which one `test-with-coverage` invokes) rather than restating it here.

The Playwright config lets Playwright's own `webServer` launch the compiled server, with the command shell-prefixed by `env -u NODE_V8_COVERAGE` so the server process doesn't inherit the parent `c8` run's coverage directory and write its own profile into it; the config builds its `baseURL` from `E2E_PORT` and pipes the server's `stdout`/`stderr` (grep the Playwright configs for `env -u NODE_V8_COVERAGE`).

Never hardcode `E2E_PORT` in a package.json script, never set `reuseExistingServer: true`, never give a server a readiness URL the nonce does not guard, and never launch the e2e server without stripping `NODE_V8_COVERAGE` — all four produce silently-wrong runs that look like real regressions.

## Never Pass a Callback to `app.listen`

Express registers the last-argument callback as the socket's `error` listener as well as its `listening` one (`server.once('error', done)`). A callback that ignores its argument therefore logs "server running" when the bind *failed*, swallows the error so Node never throws it, and exits 0. A lost port race then reports success and Playwright reports only `Process from config.webServer exited early.` with no `EADDRINUSE` anywhere.

Attach the handler instead — `app.listen(port).on('listening', …)` — so an unhandled `error` keeps Node's default behaviour: the full `EADDRINUSE` message on stderr and exit 1.

## Never Let a Failed or Unrun Visual Check Leave CI Green

A visual check — a screenshot comparison, a transition-frame capture, or the vision-model review of those frames — sees what no DOM assertion can, and a run's colour is the only output anyone reads: nobody opens a green run. A check that errored, timed out, was skipped, or had nothing to look at while its run stayed green blinds us at exactly the moment it was needed. Anything short of "verified what it exists to verify" ends its run red.

| Never | Why (observed failure) |
|-------|------------------------|
| `continue-on-error: true` on a job or step that captures, compares or reviews a visual check | GitHub reports the run green whatever the step did. The vision-model review (the GitHub workflow that sets `VLM_MODEL`) carried it and went 1,000 runs without a single red. |
| `\|\| true`, `set +e`, or a `catch` that only logs, around a visual command | The error lands in a log nobody opens. Review run 35981069833 logged `Visual review skipped: Command failed: … mlx_vlm.generate …` and concluded `success`. |
| Reading "nothing to review" as a pass | An empty input looks the same whether nothing changed or the hand-off broke. Once the web checks moved to GitHub-hosted VMs, frames stopped reaching the reviewer and 29 consecutive reviews reported `No transition frames were captured for this run.` and passed — run 36159288183 among them, though its CI run had executed the capturing suite. |
| Reading an unparseable, empty or timed-out model answer as "no defects" | The review did not happen, so it verified nothing. |
| Treating a defect the check confirmed as advisory | A finding nobody is made to look at is the same blindness as no review. |

An nx cache replay is no exemption: a replayed run must deliver the frames its original run captured, so an absent frame set means a broken hand-off, never "already checked". The one exception is a CI re-run that did not re-execute the capturing job: its review passes only on the record a clean review of that same run's frames left behind.

## Debugging E2E Test Failures

### Failure Types

| Type | Description |
|------|-------------|
| Locator Timeout | Element not found on page |
| Assertion Failure | Element exists but has wrong value |
| Action Availability | A page action's availability predicate returns an unexpected result |
| Flow Stuck | No available actions, flow incomplete |
| Max Navigations | Flow did not complete within the navigation cap (fails with `Reached max navigations`) |

### Debug Using Test Artifacts

- Screenshots on failure: `test-results/`
- Traces: Open with `npx playwright show-trace trace.zip`

### Common Fixes

| Symptom | Solution |
|---------|----------|
| Locator timeout for known element | Update selector to match current DOM |
| Flaky test (passes sometimes) | Wait for specific element state, not arbitrary timeout |
| Flow completes too early/never | Adjust the flow's success detector |
| Strict mode violation on selector | Use `a:text-is("Read")` for exact match instead of `a:has-text("Read")` |
