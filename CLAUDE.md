# Development Guidelines

## Setup

1. Install devbox: https://www.jetify.com/docs/devbox/installing-devbox#linux
  a) if unable to install devbox, check [devbox.json](./devbox.json) for required tools and install them manually (Node.js, AWS CLI, Pulumi, etc.), Check [.envrc](./.envrc) for required environment variables and set them in your shell profile (e.g., .bashrc, .zshrc)
1. Run pnpm install to install dependencies

## Product Constraints

### Imports are self-serve from /queue, with email as fallback

The CTA lives next to the save bar on `/queue` only — do **not** restore the removed "Import Your Data" landing-page card. Flow: the user uploads any file (≤ 5 MiB), the server best-effort-decodes it as text and extracts `http(s)://…` URLs, the user reviews a paginated list with every link checked by default, then clicks "Import N selected". Selected URLs are stub-saved synchronously (hostname-only metadata at t=0) and the existing `SaveLinkCommand` pipeline fills in title/excerpt/content asynchronously, so cards appear immediately and progressively populate. Files larger than 5 MiB or imports above the 2,000-URL cap fall back to the concierge email path (`readplace+migrate@readplace.com`); keep that documented in [pocket-migration.md](./projects/hutch/src/runtime/web/pages/blog/posts/pocket-migration.md).

### Crawler Health Canary Is Load-Bearing

A failure in the [crawler source health canary](./src/packages/crawl-article/scripts/health-sources.js) means production traffic is also blocked for that source. Every entry exists because a real user tried to save that type of URL and the crawler broke on it. When a canary fails, fix the crawler until the canary's URL loads — do not delete the entry to make the workflow green. Removing a source silently accepts that readers will get "Sorry, we couldn't save this link" for any URL matching that edge-sniffer's fingerprint (Cloudflare TLS fingerprinting, Fastly JA3, etc.).

Workflow for a canary failure:
1. Reproduce the failing fetch locally against the same URL before touching any code.
2. Find the block (status code, Cloudflare `cf-mitigated` header, body contents) and pick a mitigation that hits the real origin (HTTP/2 fallback, header tweaks, oembed, etc.).
3. Re-run the canary locally until the failing source passes — never commit until it does.
4. Only then push and watch CI.

## Architecture Guidelines

### Brand & Design Guidelines

For colours, typography, voice, and UI conventions, see the [brand guidelines](./BRAND_GUIDELINES.md).

### Web Adapter Conventions

For HTML/CSS/SSR conventions, see the [web skill](./.claude/skills/web/SKILL.md).

### Test Driven Design

For testing conventions and designing testable code, see the [test-driven-design skill](./.claude/skills/test-driven-design/SKILL.md).

### No Cross-Project Relative Imports

Never import from another project using relative filesystem paths (e.g., `../../../../other-project/dist/...`). These create invisible dependencies that bypass the package manager and risk cyclic imports. Extract shared code into a workspace package instead.

```typescript
// BAD - Invisible sideways dependency
const mod = path.resolve(__dirname, "../../../../hutch/dist/runtime/test-app");
const { createTestApp } = await import(mod);

// GOOD - Declared workspace dependency
const { createTestApp } = await import("hutch-test-app");
```

### Filter and Query Testing Strategy

Use integration tests for comprehensive filter/query functionality testing, not E2E tests. Filter logic tests should verify URL parameters produce correct HTML output using supertest + parseHTML.

| Test concern | Test type | Location |
|-------------|-----------|----------|
| Domain Logic | Unit test | `*.test.ts` next to implementation |
| Web Layer | Integration test | `*.route.test.ts` |


E2E tests have ~11s startup overhead per test (browser, server, navigation). Integration tests avoid this overhead while still testing the full server-side flow.

## Coding Style

### Environment Variable Access

Use `requireEnv` and `getEnv` from [projects/hutch/src/require-env.ts](projects/hutch/src/require-env.ts). Never use `process.env` directly.

```typescript
// BAD - Direct process.env access
const apiKey = process.env.API_KEY;

// GOOD - Required env var (throws if not set)
const apiKey = requireEnv('API_KEY');

// GOOD - Optional env var
const proxyUrl = getEnv('HTTPS_PROXY');
```

**Never default missing environment variables.** Always use `requireEnv` and let the process fail if a variable is not set. Do not use `getEnv` with a fallback (e.g., `getEnv("KEY") ?? ""`) to work around CI environments missing secrets. Instead, ensure the CI environment provides the variable. Silent defaults complicate debugging and create behaviour that takes longer to diagnose.

**Exception:** Playwright config files (`playwright.config.*.ts`) must use `process.env` directly. Importing `getEnv`/`requireEnv` causes the playwright process to load `require-env.ts` outside V8 coverage instrumentation, creating uncovered function entries that break the 100% function coverage threshold.

### Logging

Use `HutchLogger` from `@packages/hutch-logger` for all logging. Never use raw `console.log`/`console.error` in application code. In composition roots, create the logger with `HutchLogger.from(consoleLogger)`.

```typescript
// BAD - Raw console
console.log("[recovery] Starting…");

// GOOD - HutchLogger
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
const logger = HutchLogger.from(consoleLogger);
logger.info("[recovery] Starting…");
```

### Comments Document Why, Not What

Do not add comments that explain what code does. Only add comments to explain **why** when the reasoning isn't obvious.

```typescript
// BAD - Explains what (obvious from code)
// Re-export template function
export { createHomePageContent } from './home.template';

// GOOD - Explains why (not obvious)
// Robots noindex because this page contains personal data
robots: 'noindex, nofollow',
```

When a comment explains a specific line within a block and fits on one line, use an inline comment:

```typescript
options.addArguments("--no-sandbox"); // CI container has no user namespace
```

When a comment explains multiple lines within a block, use indexed references so the explanation stays together and each line is traceable:

```typescript
/** 1. DynamoDB stores missing attributes as null, not undefined. .nullish() accepts both. */
const Row = z.object({
  etag: z.string().nullish(), /* 1 */
  lastModified: z.string().nullish(), /* 1 */
});
```

Do not leave time-bound or plan-bound comments in the code. These include leftover notes from an implementation plan ("this is a test to do X, remove when Y is concluded"), references to the current task or PR ("added for the auth migration", "temporary until rollout completes"), or any wording that assumes a particular moment in time ("new", "recently", "for now", "currently", "as of today"). Such comments rot when the surrounding code changes — no one remembers to update them. If a condition genuinely needs to be revisited, encode it in code (a failing test, a feature flag with an owner, a tracked issue) rather than in a comment.

```typescript
// BAD - Plan-bound, will rot when the experiment ends
// Temporary: remove this branch after the migration to v2 is complete
if (useLegacyPath) { ... }

// BAD - Time-bound, becomes a lie as the code evolves
// Currently we only support GET — POST coming soon
function handle(req: Request) { ... }

// GOOD - Constraint enforced by assert; no comment to rot
function handle(req: Request) {
	assert.equal(req.method, "GET");
	// ...
}
```

### Unused Variables

Use underscore prefix (`_`) to indicate intentionally unused variables. Biome is configured to allow this.

### Runtime Validation with Zod

Use [zod](https://zod.dev/) for validating external input at system boundaries (HTTP requests, external API responses). Do NOT use zod for internal function parameters already typed by TypeScript.

| Method | Use case |
|--------|----------|
| `.safeParse()` | User-facing validation |
| `.parse()` | Invalid data indicates a bug |
| `z.infer<>` | Derive TypeScript type from schema |

### Prefer Wrappers Over Global Modifications

When extending functionality (e.g., adding proxy support to fetch), create a wrapper module that exports a decorated version as the default export.

```typescript
// BAD - Modifying global
globalThis.fetch = createProxyFetch();

// GOOD - Wrapper module with same interface
// fetch-with-proxy.ts
export default createProxyFetch();
```

### No Design Pattern Names in Identifiers

Use domain-focused names, not implementation-pattern names.

```typescript
// BAD
interface ArticleRepository { ... }
class ArticleService { ... }

// GOOD
type SaveArticle = (article: Article) => Promise<void>;
type FindArticleById = (id: ArticleId) => Promise<Article | undefined>;
```

### Named Parameters Over Positional When Types Repeat

When a function signature has 2 or more consecutive parameters of the same type (e.g., `(string, string)` or `(number, number)`), use a named parameter object instead. Positional arguments of the same type are easy to swap by accident (connascence of position is weaker than connascence of name).

```typescript
// BAD - Two consecutive strings are easy to swap
type Login = (email: string, password: string) => Promise<LoginResult>;
await auth.login("user@example.com", "password123");

// GOOD - Named parameters prevent accidental swaps
type Login = (credentials: { email: string; password: string }) => Promise<LoginResult>;
await auth.login({ email: "user@example.com", password: "password123" });
```

This does NOT apply when the types differ (e.g., `(string, number)`) or when there is only one parameter.

### Prefer Compile-Time Constraints Over Runtime Validation

When a value has a known finite set of valid options, use TypeScript's type system to make invalid states unrepresentable at compile time. Only fall back to runtime validation when the value comes from outside the type system (user input, external APIs).

```typescript
// BAD - Runtime assert for something the type system can enforce
const mode = requireEnv("PERSISTENCE");
assert(mode === "prod" || mode === "development");

// GOOD - Constrained at compile time via generic
const mode = requireEnv<"prod" | "development">("PERSISTENCE");
// mode is typed as "prod" | "development" — no assert needed
```

### No Default Noop Logger in Production Code

Never default a logger dependency to `noopLogger` in production code. A missing logger silently swallows errors and makes debugging impossible. Always require the caller to pass a logger explicitly. Use `noopLogger` only in test code where logging output is intentionally suppressed.

```typescript
// BAD - Silent failure in production
function createWidget(deps?: { logger?: HutchLogger }) {
	const logger = deps?.logger ?? noopLogger;
}

// GOOD - Logger is required
function createWidget(deps: { logger: HutchLogger }) {
	const logger = deps.logger;
}

// GOOD - noopLogger in tests
const widget = createWidget({ logger: HutchLogger.from(noopLogger) });
```

### Use `assert` for Runtime Invariants

Use `assert` from `node:assert` for runtime invariant checks instead of `if`/`throw`. Assert is more concise, communicates intent clearly, and integrates with coverage tooling (no uncovered branches for the truthy path).

```typescript
// BAD - Verbose, creates coverage branches
if (!entity.properties) {
	throw new Error("Server response entity missing properties");
}

// GOOD - Concise, clear intent
import assert from "node:assert";
assert(entity.properties, "Server response entity missing properties");

// GOOD - Strict equality in test code
import assert from "node:assert/strict";
assert.equal(actual, expected, "Values should match");
```

Use `assert` from `node:assert` in production code (non-strict, allows falsy checking). Use `assert` from `node:assert/strict` in test code for strict equality semantics.

### No Default In-Memory Implementations

Never default a dependency to an in-memory implementation in production code. All dependencies MUST be mandatory and the in-memory or production implementations are explicitly set at the entry point (composition root). In-memory implementations are for tests only.

```typescript
// BAD - Silent fallback to in-memory
function createWidget(deps: { store?: Store }) {
	const store = deps.store ?? initInMemoryStore();
}

// GOOD - Store is required
function createWidget(deps: { store: Store }) {
	const store = deps.store;
}
```

### Branded Types for Domain IDs

Use branded types to prevent mixing up identifiers.

```typescript
type ArticleId = string & { readonly __brand: 'ArticleId' };
type UserId = string & { readonly __brand: 'UserId' };
```

### Avoid TypeScript Type Assertions (`as`)

Do not use `as` to cast types. Type assertions bypass the compiler and create weak connections between modules — if a type changes upstream, `as` silently hides the mismatch instead of producing a compile error.

```typescript
// BAD - Assertion hides type mismatches
const userId = rawValue as UserId;
const item = dbResult.Item.url as string;

// GOOD - Validated factory with Zod + infer
const UserIdSchema = z.string().brand<'UserId'>();
type UserId = z.infer<typeof UserIdSchema>;
const userId = UserIdSchema.parse(rawValue);

// GOOD - Zod schema at system boundary (DynamoDB, HTTP, etc.)
const SavedArticleRow = z.object({
  id: ArticleIdSchema,
  url: z.string(),
  // ...
});
function fromItem(item: Record<string, unknown>): SavedArticle {
  return SavedArticleRow.parse(item);
}

// BAD - Faking a partial object with `as`
function createFakeResponse(): Response {
  return { status: 200, ok: true } as Response;
}

// GOOD - Partial<T> makes the subset explicit
function createFakeResponse(): Partial<Response> {
  return { status: 200, ok: true };
}
```

**Allowed exceptions:**

| Exception | Reason |
|-----------|--------|
| `as const` | Not a type assertion — narrows literal types |
| Isolated Node.js API wrappers (e.g., `promisify(scrypt)` returning `Buffer`, `requireEnv` generic) | The `as` is already contained in a single wrapper function with no better alternative from the type definitions |

## CLI Commands

### Prefer Longhand Parameters

Always use longhand (full) parameter names in CLI commands for clarity.

```bash
# GOOD - Self-documenting
livereload src --exts html,css,ts --wait 500

# Avoid - Requires API knowledge
livereload src -e html,css,ts -w 500
```

## Test Runner Logging

When logging test phase transitions (e.g., "Running unit tests", "Running E2E tests"), prefix with the project name so it's clear which project is running when multiple projects run together.

```javascript
// BAD - Ambiguous in monorepo output
console.log('\n=== Running E2E tests ===\n')

// GOOD - Clear which project is running
console.log('\n=== Readplace - Running E2E tests ===\n')
```

## Code Coverage

### Coverage Over Legibility

100% code coverage is more important than code legibility. When a code path cannot be exercised by tests — whether due to V8 engine instrumentation quirks (e.g., `??` creating unreachable branches) or because the fallback is unreachable by design — remove the dead code OR rewrite it to eliminate the untestable path. Do not leave dead fallbacks in place and lower thresholds to accommodate them.

```typescript
// BAD - ?? creates a V8 branch for a null case that never happens
const wrapper = document.querySelector("div") ?? document.documentElement;

// GOOD - assert eliminates the untestable branch (no V8 branch in caller)
const wrapper = document.querySelector("div");
assert(wrapper, "parseHTML('<div>...') must produce a <div>");
```

When V8 coverage instrumentation requires restructuring code, make those changes with explanatory comments linking to verified online resources.

### No Coverage Ignore Comments

Coverage ignore comments (`/* c8 ignore */`) are forbidden unless explicitly approved. Instead, restructure code to eliminate untestable branches.

```typescript
// BAD - hiding untested code
/* c8 ignore start */
if (value === null) { return defaultValue }
/* c8 ignore stop */

// GOOD - assertion fails fast
assert(value !== null, 'Value must not be null')
```

### Allowed `c8 ignore` Cases

When `c8 ignore` is necessary, use inline comments — do NOT add individual files to `enforce-coverage.config.js` `extraExcludePatterns`. Config excludes are for whole directories (e.g., `src/infra/**`).

**Thin AWS SDK wrappers** tested via integration tests (not Jest): use whole-file `/* c8 ignore start/stop */` with a reason.

```typescript
/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
export function initS3PutObject(deps: { client: S3Client; bucketName: string }) { ... }
/* c8 ignore stop */
```

**CI-only retry callbacks** that never fire during a passing local run:

```typescript
beforeRetry: /* c8 ignore next */ async (p) => { await p.reload({ waitUntil: 'domcontentloaded' }) },
```

**V8 async function artifacts**: `await` and `return` statements in `async` functions create V8 continuation branches that no test can exercise — they are runtime state machine internals, not logical code paths. Use `/* c8 ignore next */` on the specific line.

**V8 block coverage phantoms**: V8's bytecode-level block coverage creates zero-count sub-ranges inside executed code. These appear as uncovered branches in c8/v8-to-istanbul output even though the code runs. Common triggers: `||`/`&&` continuation counters, `for...of` iterator protocol, ternary `?:` combined with `||`. Code restructuring only moves the phantom — it does not eliminate it. Use `/* c8 ignore next */` with a reference to [bcoe/c8#319](https://github.com/bcoe/c8/issues/319) and [V8 block coverage design](https://v8.dev/blog/javascript-code-coverage). Where possible, use `assert` to replace `||` fallbacks that guard against `null`/`undefined` — this eliminates real uncovered branches (the assert's branch lives inside the assert function, not in the caller's V8 block coverage).

### Never Add Excludes or Ignore Patterns to Coverage, Lint, Knip, etc. Without Approval

Never add exclude patterns to any `enforce-coverage.config.js` or `enforce-coverage.config.base.js` including knip, biome, etc. without explicit human approval. When coverage fails because a file needs to be excluded, present the situation and ask before adding the pattern.

## CI/CD Guidelines

### Always Verify Changes with `pnpm check`

Run `pnpm check` (or `pnpm nx run <project>:check` for a single project) to verify changes. Do NOT run lint, type-check, tests, coverage, knip, or unused-css individually — the `check` target already composes all of them under one nx invocation, mirrors what the pre-commit hook runs, and uses the same nx cache. Reaching into the underlying tooling separately wastes time, gets different cache hits than the hook does, and can mask mismatches between local verification and the pre-commit run.

```bash
# GOOD - one command, matches the pre-commit hook
pnpm check

# GOOD - single project
pnpm nx run hutch:check

# BAD - bypasses the meta-target, drifts from the hook
pnpm exec tsc --noEmit
pnpm exec biome lint src
pnpm nx run hutch:test-with-coverage
```

Use individual nx targets only when `pnpm check` has already surfaced a specific failure and you're isolating that one task while debugging.

### Never Bypass Git Commit Hooks

Never use `--no-verify` without explicit human approval. If hooks fail:
1. Investigate the failure
2. Fix the underlying issue
3. Ask the human if you cannot fix it

See the [git-commit skill](./.claude/skills/git-commit/SKILL.md) for pre-commit hook failure diagnostics.

## Architecture

### Project Structure

Monorepo at the repository root. Main application lives in `projects/hutch/src/` with two top-level directories:

- `src/runtime/` — Application code (Express SSR app and Lambda entry points)
- `src/infra/` — Infrastructure as Code (Pulumi)

### Runtime vs Infra Code

A module belongs under an `infra` directory only if it imports Pulumi. Everything else belongs under `runtime` — including Lambda entry points and composition roots that wire dependencies but have no test-worthy logic. Nothing outside `infra` should import from `infra`.


<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

## General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->