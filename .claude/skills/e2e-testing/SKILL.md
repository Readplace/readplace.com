---
name: e2e-testing
description: E2E testing conventions using Playwright and the HATEOAS-based test framework. Use when working with E2E tests, files in e2e/ directories, *.e2e*.ts files, or when test errors mention Playwright, HATEOASClient, NavigationHandler, PageAction, or locator timeouts.
---

# E2E Testing Guidelines

Conventions for writing and debugging E2E tests using the project's HATEOAS-based Playwright test framework.

## Architecture

State machine-based test runner where tests provide data and the runner automatically discovers and executes available actions.

For implementation details, see `src/e2e/hateoas/` and any `*.e2e-local.ts` file in `src/e2e/`.

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

**CRITICAL**: PageAction `isAvailable` functions MUST use element-based detection, NOT URL path checks.

Use `assert` (from `node:assert/strict`) inside `isAvailable` to verify element state. This ensures the check line is properly covered by test instrumentation. The surrounding `try/catch` converts assertion failures into `false` returns.

```typescript
// FORBIDDEN
isAvailable: async page => {
  if (page.url().includes('/flights')) return false
}

// REQUIRED - Element-based with assert
isAvailable: async page => {
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

Form submissions and link clicks may cause full page reloads or HTMX AJAX swaps. Use `clickAndWaitForPageReload` which handles both:

```typescript
async function clickAndWaitForPageReload(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  const loadOrHtmxSwap = Promise.race([
    page.waitForEvent('load'),
    page.waitForResponse(resp => resp.request().headers()['hx-request'] === 'true'),
  ])
  await locator.click()
  await loadOrHtmxSwap
}
```

Without this, `waitForLoadState('domcontentloaded')` may resolve immediately before navigation starts.

## Prefer Self-Contained Test Data

Keep test data inline within each E2E test flow rather than extracting to shared fixtures.

## Determinism and Hermeticity

Every flake root-caused in the hutch 20x-soak investigation was an uncontrolled input reaching a test: live CDN fetches, host network state, and waits on "quiet" proxies instead of the asserted condition. These rules bind new E2E and UI code; the referenced files are the canonical implementations.

| Rule | Why (observed failure) |
|------|------------------------|
| Local suites import `test` from `hermetic-cdn.ts` (hutch `src/e2e/`), never `@playwright/test` directly. Any asset a shared template loads from a third-party host gets pinned into `e2e-cdn-fixtures/` **in the same change** — page tests inherit template dependencies invisibly. | Font-fetch races under 9-worker load rendered a shrink-to-fit element 1px narrower (45% of runs) and hung `document.fonts.ready` to the 120s timeout. |
| Pin the closure of an asset set: every file the pinned CSS can reference must exist in the fixtures, including fallback formats. | Chromium requests the `.ttf` fallback when a woff2 fetch aborts mid-navigation; `route.fulfill` on a missing file kills the test. |
| Wait for the condition the next line asserts — never `networkidle`, bare `document.fonts.ready`, or timeouts. See `waitForBrandFonts` (hermetic-cdn.ts) and the terminal body-class assert in `queue-flow/view-page-actions.ts`. | Both proxies failed in both directions: resolved before the guarded state existed, and hung after the terminal state was reached. |
| After an async mutation, poll until its effect is visible before re-reading dependent state. See the delete loop in `queue-flow/queue-actions.ts`. | Re-counting delete buttons before the htmx swap landed clicked a button the swap was removing — a 120s hang on the last item. |
| Host state is a test input: suppress timer-, clock-, and `navigator.onLine`-driven UI before pixel capture, and give any new such UI a deterministic opt-out. See `settleNarrow` in `verify-banner-nav-visual.e2e-local.ts`. | A Wi-Fi drop rendered the offline banner into 14 consecutive captures (+38px). |
| Prefer numeric geometry assertions over screenshots; screenshot only metric-stable surfaces (fixed dimensions, settled fonts). See the handle-height test in `crawl-bookmark-visual.e2e-local.ts`. | A 1px font-metric shift hard-fails `toHaveScreenshot` on size before any diff threshold applies. |
| Regenerate snapshot baselines under the exact gate conditions: `HEADLESS=true`, hermetic fixtures, and for `-linux` baselines the CI-matching Playwright container (`git log` the `-snapshots` dirs for the recipe). | Baselines captured against live-CDN font bytes failed 20/20 on CI once rendering became deterministic. |
| A flake fix is proven by a 20x uncached `pnpm check` soak, not one green run. One mechanism-backed fix per observed failure; if the same failure recurs after the fix, revert it instead of patching on top. | The 45%-rate flake passed single pre-commit runs repeatedly; misattributed fixes survived single retests and fell to soaks. |

## Coverage for E2E Test Support Code

E2E test support files (`src/e2e/**`) are **not excluded** from coverage enforcement. They run under c8 during `pnpm check` and must meet the same thresholds as production code.

The single exception is `CLAUDE_CODE_REMOTE=true`, which makes `shouldSkipE2E` skip every `e2e: true` phase (see `defaultDeps` in [run-test-phases.ts](../../../src/packages/test-phase-runner/src/run-test-phases.ts)) and, because those files then never execute, also excludes `src/e2e/**` from the thresholds (see [enforce-coverage.config.base.js](../../../enforce-coverage.config.base.js)). Set it only where a browser genuinely cannot run — it buys a green that verifies strictly less, and the coverage gate cannot backstop it, because the same flag removes `src/e2e/**` from the threshold set and a skipped run still reports 100%.

The variable is an nx hash input on `test`, `test-with-coverage` and `check` (in [nx.json](../../../nx.json), and repeated in each extension's `project.json`, whose `inputs` array shadows the target default rather than merging with it). That keeps the skipped run and the full run in separate cache entries, so a green produced with E2E skipped can never replay as a green for a run that needs them.

For `c8 ignore` rules, allowed cases, and V8 coverage quirks, see the [Code Coverage section in CLAUDE.md](../../../CLAUDE.md#code-coverage).

## Running E2E Tests

E2E tests run as part of `pnpm check` via `@packages/test-phase-runner`. Each project has a `run-tests.config.js` declaring its phases (Jest unit, Jest integration, Playwright, `node:test` — each project picks what it needs) and a thin `scripts/run-tests-with-coverage.js` that allocates a free port via `getFreePort`, assigns it to `E2E_PORT`, and delegates to the runner. `pnpm test:e2e` runs just the Playwright phase directly for local iteration.

### Staging e2e

Only projects with a `deploy-infra` target have a staging e2e config. After `project-deployment.yaml` deploys to staging, it runs the project's `post-deploy` target, which reads the deployed URL from `pulumi stack output` and runs `STAGING_URL=$URL pnpm test:e2e:staging`. Results land in `test-results-staging/` and the workflow uploads that directory as a GitHub Actions artifact.

The staging Playwright config sets `webServer: undefined` (Playwright is pointed at a remote instance, not launching one) and uses a longer timeout and one retry.

### Why `test-phase-runner`, not `@nx/playwright`

The repo invokes raw Playwright CLI through `test-phase-runner` rather than adopting the `@nx/playwright` plugin. The runner already sequences phases across Jest, `node:test`, and Playwright — extensions need all three — and the dynamic port + `NODE_V8_COVERAGE` discipline lives outside Playwright entirely (in `scripts/run-tests-with-coverage.js` and the Playwright config). Adding the Nx plugin would overlap that orchestration without replacing it.

## Never Reuse an Existing Server — Every Run Gets a Fresh One on a Fresh Port

Playwright's `reuseExistingServer: true` is forbidden. If a stale dev server or a previous test run is still bound to the same port, Playwright silently connects to it and runs against the wrong instance. The failures look like real regressions and the passes are worse — tests that pass against the wrong state. The factory in `playwright.config.factory.ts` hard-codes `reuseExistingServer: false` as a safety net for every config it produces.

Pair that with a dynamically allocated port so a hardcoded number can't collide with a running dev server:

```ts
// scripts/run-tests-with-coverage.js — allocate a free port before any phase runs
const { initTestPhaseRunner, defaultDeps, getFreePort } = require('@packages/test-phase-runner')

async function main() {
  process.env.E2E_PORT = String(await getFreePort())

  const config = require('../run-tests.config.js')
  const { createTestPlan } = initTestPhaseRunner(defaultDeps)
  const plan = createTestPlan({ config, projectRoot: join(__dirname, '..') })
  await plan.runAllPhases()
}
```

The Playwright config lets Playwright's own `webServer` launch the compiled server, with the command shell-prefixed by `env -u NODE_V8_COVERAGE` so the server process doesn't inherit the parent `c8` run's coverage directory and write its own profile into it:

```ts
// playwright.config.local-dev.ts
export default createPlaywrightConfig({
  baseURL: `http://localhost:${process.env.E2E_PORT || '0'}`,
  webServer: {
    command: 'env -u NODE_V8_COVERAGE node dist/e2e/e2e-server.main.js',
    url: serverUrl,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  // ...
})
```

Never hardcode `E2E_PORT` in a package.json script, never set `reuseExistingServer: true`, and never launch the e2e server without stripping `NODE_V8_COVERAGE` — all three produce silently-wrong runs that look like real regressions.

## Debugging E2E Test Failures

### Failure Types

| Type | Description |
|------|-------------|
| Locator Timeout | Element not found on page |
| Assertion Failure | Element exists but has wrong value |
| Action Availability | PageAction.isAvailable returns unexpected result |
| Flow Stuck | No available actions, flow incomplete |
| Max Navigations | Flow did not complete within maxNavigations limit |

### Debug Using Test Artifacts

- Screenshots on failure: `test-results/`
- Traces: Open with `npx playwright show-trace trace.zip`

### Common Fixes

| Symptom | Solution |
|---------|----------|
| Locator timeout for known element | Update selector to match current DOM |
| Flaky test (passes sometimes) | Wait for specific element state, not arbitrary timeout |
| Flow completes too early/never | Adjust successDetector logic |
| Strict mode violation on selector | Use `a:text-is("Read")` for exact match instead of `a:has-text("Read")` |
