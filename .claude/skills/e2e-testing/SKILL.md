---
name: e2e-testing
description: E2E testing conventions using Playwright and the HATEOAS-based test framework. Use when working with E2E tests, files in e2e/ directories, *.e2e*.ts files, or when test errors mention Playwright, the HATEOAS test client, its navigation handler, page actions, or locator timeouts.
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
| Prefer numeric geometry assertions over screenshots; screenshot only metric-stable surfaces (fixed dimensions, settled fonts). See the grip-height test in the crawl-bookmark visual suite (grep for `grip height`). | A 1px font-metric shift hard-fails `toHaveScreenshot` on size before any diff threshold applies. |
| Regenerate snapshot baselines under the exact gate conditions: `HEADLESS=true`, hermetic fixtures, and for `-linux` baselines the CI-matching Playwright container (`git log` the `-snapshots` dirs for the recipe). | Baselines captured against live-CDN font bytes failed 20/20 on CI once rendering became deterministic. |
| A flake fix is proven by a 20x uncached `pnpm check` soak, not one green run. One mechanism-backed fix per observed failure; if the same failure recurs after the fix, revert it instead of patching on top. | The 45%-rate flake passed single pre-commit runs repeatedly; misattributed fixes survived single retests and fell to soaks. |
| A fixture that must land a crawl in its `failed` state answers a status the pipeline settles in-process — `404`/`410` (`not-found`) or a block-class status (`blocked`; the crawler's persona-fallback module lists the block status codes) — never a `5xx`. A `5xx` is a retriable fetch: the save-link worker and the comprehensive crawl handler rethrow it, so the row stays `pending` until SQS dead-letters the message and the DLQ handler settles it, a wait bounded by the queue's visibility timeout set in the save-link stack's infrastructure. Only the synchronous in-memory pipeline hides this locally. | The staging crawl-fails leg waited its full 180s on "Generating clean reader view" for a `500` fixture the local run had settled instantly through the in-memory store's crawl-failed transition (CI run 33287875827). |

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
