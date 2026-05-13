---
name: test-driven-design
description: Software design and testing conventions that support testability. Use when writing tests, designing testable code, working with dependency injection, or when test coverage issues arise.
---

# Test Driven Design Guidelines

Conventions for writing tests and designing code that is easy to test.

## Design for Testability

### Prefer Additions and Removals Over Line Edits (Open/Closed)

When changing behaviour for a new requirement, prefer a diff that is mostly **new files / new functions** or **wholesale deletions** over one that rewrites lines inside existing code — in-place edits are a smell. Code following the Open/Closed Principle grows by addition (new strategy, new handler, new module wired at the composition root) and shrinks by deletion (whole files or branches removed when a feature is retired), not by editing the middle of a function.

Apply this as a review heuristic on your own diff before sending it:

- If the diff is mostly `+`/`-` of whole blocks/files: good — likely extending rather than modifying.
- If the diff is mostly mixed line edits inside an existing function: pause. Can the new behaviour live in a new function/module that the composition root selects between, leaving the existing path untouched?
- Refactors that preserve behaviour are exempt — renaming, extracting, or simplifying internals will naturally produce line-level edits, and that is the point.

```typescript
// ❌ BAD - New "premium" tier added by editing the middle of an existing function
function priceFor(plan: Plan) {
	if (plan === "free") return 0;
	if (plan === "pro") return 10;
	if (plan === "premium") return 25; // <-- new line wedged in
	throw new Error("unknown plan");
}

// ✅ GOOD - New tier added as a new entry; existing entries untouched.
// Retiring a tier is a clean deletion of one line, not a rewrite.
const PRICES = {
	free: 0,
	pro: 10,
	premium: 25, // <-- pure addition
} satisfies Record<Plan, number>;
function priceFor(plan: Plan) {
	return PRICES[plan];
}
```

The testing payoff: additions and deletions map onto whole new tests being added or whole obsolete tests being removed. Line-edit diffs tend to mutate existing tests in ways that erode their meaning — a test that "still passes" after its assertions were rewritten is no longer protecting the original behaviour.

Two refactors that almost always pay for themselves before adding a new case:

1. **Replace an `if`/`switch` ladder with a map** when each branch returns a value or calls a same-shape function. The ladder is closed-for-extension by construction; the map is open.
2. **Push the conditional up to the composition root.** If the new behaviour differs by environment, tenant, or feature flag, the branch belongs at the entry point that wires dependencies — not deep in a domain function. Domain code then stays oblivious to which variant it is running.

If none of these shapes fit and the new case genuinely requires editing existing logic, that is a signal that MUST surface as a report to the user — not silently absorbing as line edits.

### Dependency Injection Over Mocks

Prefer dependency injection over `jest.mock()`. Mocks couple tests to implementation details.

```typescript
// ❌ BAD - Couples test to module structure
jest.mock('./services/email-service');

// ✅ GOOD - Inject dependencies via factory function
export function createApp(deps: AppDependencies) { ... }
```

For real examples, see `projects/hutch/src/server.ts` which composes all dependencies at startup.

### Partial Application for Domain Functions

Domain functions with dependencies must use partial application. Use an `init*` prefix for the initialization function.

```typescript
// ❌ BAD - Dependencies mixed with execution parameters
export function createPaymentPlan(input: Input, deps: Deps) { ... }

// ✅ GOOD - Partial application separates concerns
export function initCreatePaymentPlan(deps: Deps): (input: Input) => PaymentPlan { ... }
```

For real examples, see `init*` functions in `projects/hutch/src/domain/` and `projects/hutch/src/providers/`.

### Do Not Export Internal Functions for Testing

Do not export functions solely so tests can call them directly. Constructor functions (`init*`) MUST return all functions that need testing as part of their return value — analogous to how class methods are accessed through an instance, not exported separately.

```typescript
// ❌ BAD - Exporting internal function for test access
export function createBuildPlan(input: Input) { ... }
export function initBuildExtension(deps: Deps) {
	return async function buildExtension(input: Input) {
		const plan = createBuildPlan(input);
		// ...
	};
}

// ✅ GOOD - Plan returned from init*, with execution as a method on the plan
function createPlanData(input: Input) { ... }
export function initBuildExtension(deps: Deps) {
	return {
		createBuildPlan(input: Input) {
			const planData = createPlanData(input);
			return {
				...planData,
				async buildExtension() { /* uses planData and deps */ },
			};
		},
	};
}

// Test accesses plan data through init -> createBuildPlan
const { createBuildPlan } = initBuildExtension({ ...inMemoryDeps });
const plan = createBuildPlan({ ... });
expect(plan.esbuildOptions.target).toBe("firefox91");

// Execution is a method on the plan itself
await plan.buildExtension();
```

### No Design Pattern Names in Identifiers

Do not name variables, functions, types, or files with design pattern suffixes like `Service`, `Factory`, `Singleton`, etc.

```typescript
// ❌ BAD
interface EncryptedLinkService { ... }

// ✅ GOOD - Domain-focused name
interface EncryptedLink { ... }
```

### Make Invalid States Non-Representable

Use TypeScript's type system to prevent invalid states at compile time.

```typescript
type SupportedLocale = 'en-AU';
```

### No Silent Fallbacks for Missing Values

Do not use conditionals to provide empty defaults when a dependency may be null. This allows the system to continue in an invalid state.

```typescript
// ❌ BAD - Silent fallback hides missing config
const targets = toCustomerEmail ? [toCustomerEmail] : [];

// ✅ GOOD - Fail fast if required
const resendApiKey = requireEnv("RESEND_API_KEY");
```

### No Default In-Memory Implementations

Never default a dependency to an in-memory implementation in production code. All dependencies MUST be mandatory and the in-memory or production implementations are explicitly set at the entry point (composition root). In-memory implementations are for tests only.

```typescript
// ❌ BAD - Silent fallback to in-memory
function createWidget(deps: { store?: Store }) {
	const store = deps.store ?? initInMemoryStore();
}

// ✅ GOOD - Store is required
function createWidget(deps: { store: Store }) {
	const store = deps.store;
}
```

### Named Parameters Over Positional When Types Repeat

When a function signature has 2 or more consecutive parameters of the same type (e.g., `(string, string)` or `(number, number)`), use a named parameter object instead. Positional arguments of the same type are easy to swap by accident (connascence of position is weaker than connascence of name).

```typescript
// ❌ BAD - Two consecutive strings are easy to swap
type Login = (email: string, password: string) => Promise<LoginResult>;
await auth.login("user@example.com", "password123");

// ✅ GOOD - Named parameters prevent accidental swaps
type Login = (credentials: { email: string; password: string }) => Promise<LoginResult>;
await auth.login({ email: "user@example.com", password: "password123" });
```

This does NOT apply when the types differ (e.g., `(string, number)`) or when there is only one parameter.

### No Unnecessary Runtime Validation

If TypeScript already enforces a constraint at compile time, do not add runtime validation for the same constraint.

### No Defensive Checks Without Valid Tests

Every code path must be exercised by tests. Do not add `|| ''` or `?? defaultValue` unless there is a test for the fallback.

## Writing Tests

### Selector Strategy

- Hook into CSS classes for querying elements, not visual text
- Use `data-test-*` attributes for test metadata
- Avoid coupling to labels/view text

For example patterns, see tests in `projects/hutch/src/web/pages/`.

### Test Behavior, Not Element Existence

Do not write assertions that only check if an element exists.

```typescript
// ❌ BAD - Only checks element exists
expect(input).not.toBeNull();

// ✅ GOOD - Tests behavior
input.value = 'John';
expect(input.value).toBe('John');
```

#### Never Rely on `querySelector(...).toBeNull()` — Assert Existence First, Then Check State

`expect(doc.querySelector(...)).toBeNull()` is a fragile way to prove "this element should be hidden" — a typo in the selector also returns `null`, so the assertion passes for the wrong reason. The same bug hides in `.not.toBeNull()`: a typo makes the assertion fail even when the production code is correct.

Render the element unconditionally and encode visibility as **metadata on the element** (a state class or `data-*` attribute). Tests look the element up first, assert it exists, and then check the metadata. A selector typo now fails at `assert(element)` instead of silently passing a visibility assertion.

```typescript
// ❌ BAD - A typo in the selector makes this assertion trivially true
expect(doc.querySelector("[data-test-onboarding]")).toBeNull();

// ❌ BAD (subtler) - A typo makes the assertion fail for the wrong reason
expect(doc.querySelector("[data-test-onbording]")).not.toBeNull(); // typo

// ✅ GOOD - Assert the element exists, then check its state via metadata
const container = doc.querySelector("[data-test-onboarding]");
assert(container, "onboarding container must be rendered");
expect(container.classList.contains("onboarding--hidden")).toBe(true);
```

This forces the production code to always render the element and toggle a state class (or `data-*` attribute) for visibility. Pair with CSS that makes the state explicit on both sides — don't rely on the element's default `display`:

```css
.onboarding--visible { display: block; } /* explicit default for a <section> */
.onboarding--hidden  { display: none; }
```

The same pattern applies to any binary rendering decision (shown/hidden, enabled/disabled, expanded/collapsed): render unconditionally, toggle a class, assert on the class.

### Avoid Negative Test Assertions

Negative assertions (`.not.toContain()`) become stale when code is refactored.

```typescript
// ❌ BAD - Becomes stale if format changes
expect(subtitleText).not.toContain('–');

// ✅ GOOD - Test the actual expected value
expect(subtitleText).toBe('SYD to MEL');
```

### Prefer Self-Contained Test Data

Keep test data inline within each test case rather than extracting to shared fixtures.

### External API Integration Tests Must Use Retry Logic

When testing external APIs (e.g., Amadeus flight search), use the `Retriable` class from `test-utils` to implement retry logic. Do NOT switch to static/mock providers to mask real API behavior.

For usage examples, see `projects/hutch/src/test-utils.ts`.

### Never Test Code That Is Only Used in Tests

Do not create unit tests for functions, types, or schemas that are only used by other tests. If a function is exported but never imported by production code, delete it.

### Meaningful Variable Names Over Technical Prefixes

```typescript
// ❌ BAD - Technical prefix without meaning
const mockSearchParams = { ... };

// ✅ GOOD - Describes what the data represents
const sydneyToMelbourneParams = { ... };
```

### Thin AWS SDK Wrappers Are Unit-Tested With Fake Clients

For files that wrap a single AWS SDK call (DynamoDB `update`, S3 `get`, EventBridge `publish`):

- Use the `Partial<DynamoDBDocumentClient>` fake-client pattern. Capture the command in a closure and assert on `UpdateExpression`, `ConditionExpression`, and `ExpressionAttributeValues` shape with `toContain` (not `toBe`) so minor formatting changes don't break the test. To find current examples, grep for `Partial<DynamoDBDocumentClient>` in `*.test.ts`.
- Reach 100% coverage with the fake client. Do NOT add a `.integration.ts` to plug coverage gaps — extract the mapping/parsing logic into a dedicated helper and unit-test the helper directly.
- When the wrapper is truly trivial (3–5 lines, no branching), mark it `/* c8 ignore start -- thin AWS SDK wrapper, tested via production canaries */` and rely on production canaries for end-to-end verification. To find current canaries, look for `.canary.ts` or `health-*` scripts in each project.
- Reserve `.integration.ts` files for cross-service flows that benefit from real-AWS sanity checking. Mark their phase `e2e: true` in the project's `run-tests.config.js` so they don't gate CI on AWS credentials being present.

## Code Coverage

For coverage thresholds, `c8 ignore` rules, V8 quirks, and async coverage artifacts, see the [Code Coverage section in CLAUDE.md](../../../CLAUDE.md#code-coverage).
