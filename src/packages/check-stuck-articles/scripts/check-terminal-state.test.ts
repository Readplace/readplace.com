import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTerminalState } from "./check-terminal-state";

describe("checkTerminalState", () => {
	it("returns terminal:true when both state machines are ready and the summary text is present", () => {
		// Why this matters: the happy path on the production write contract —
		// saveGeneratedSummary writes `summary`, `summaryExcerpt`, and
		// `summaryStatus='ready'` together; the crawl pipeline writes
		// `crawlStatus='ready'` on a successful tier promotion. Any future
		// regression that treats this combination as stuck would page the
		// operator on every healthy article.
		const result = checkTerminalState({
			summaryStatus: "ready",
			crawlStatus: "ready",
			summary: "the summary",
		});
		assert.deepStrictEqual(result, { terminal: true });
	});

	it("returns terminal:true when the summary was deliberately skipped (content-too-short etc.)", () => {
		// Why this matters: `skipped` is a terminal outcome with a documented
		// reason (e.g. content-too-short). The canary must not surface these
		// as stuck — they represent a deliberate decision by the summariser
		// and the reader UI renders a "no summary available" message rather
		// than polling forever.
		const result = checkTerminalState({
			summaryStatus: "skipped",
			crawlStatus: "ready",
			summary: undefined,
		});
		assert.deepStrictEqual(result, { terminal: true });
	});

	it("returns terminal:false with the writer-contract message when summaryStatus=ready but the summary text is missing", () => {
		// Why this matters: this is the exact regression that left 44 rows
		// stuck after the 2026-05-10 freshness refresh. The classifier alone
		// returns a code; this presentation layer is what an on-call operator
		// reads first in the CI log to know whether to escalate to the
		// engineer who owns the producer side. The message intentionally
		// names the writer-contract violation, not just the row state.
		const result = checkTerminalState({
			summaryStatus: "ready",
			crawlStatus: "ready",
			summary: undefined,
		});
		assert.deepStrictEqual(result, {
			terminal: false,
			message:
				"summaryStatus is 'ready' but the summary text is missing (writer-contract violation: a producer dropped 'summary' without resetting 'summaryStatus' to 'pending')",
		});
	});

	it("concatenates messages when BOTH state machines are non-terminal", () => {
		// Why this matters: a single row can stall on more than one axis at
		// the same time (e.g. a crawl that failed before the summary worker
		// got a chance to run, with a leftover pending summaryStatus from a
		// prior attempt). The output has to surface both axes so the operator
		// fixes the right one first — not just the one classifyRow happened
		// to list first.
		const result = checkTerminalState({
			summaryStatus: "pending",
			crawlStatus: "failed",
			summary: undefined,
		});
		assert.equal(result.terminal, false);
		assert.equal(
			result.terminal === false ? result.message : "",
			"summaryStatus is 'pending' — summary worker never produced a terminal outcome; crawlStatus is 'failed' — crawl worker recorded a non-recoverable failure",
		);
	});

	it("returns terminal:false with the legacy-stub message for rows with no statuses and no summary", () => {
		// Why this matters: legacy stubs pre-date the state machines. The
		// canary surfaces them so they can be re-primed via the existing
		// resolveReaderState heal branch (article-reader.ts:101); the
		// operator-facing message must say "legacy stub" — not "pending" —
		// so the operator knows the fix is "kick the row through /view"
		// rather than "wait for the worker to finish".
		const result = checkTerminalState({
			summaryStatus: undefined,
			crawlStatus: undefined,
			summary: undefined,
		});
		assert.deepStrictEqual(result, {
			terminal: false,
			message:
				"legacy stub — row pre-dates the state machines and carries neither status attributes nor a backfilled summary",
		});
	});

	it("treats a row with a backfilled summary and no status as terminal", () => {
		// Why this matters: rowToGeneratedSummary maps these to {status:
		// 'ready'} via the legacy fall-through; the reader renders the
		// pre-computed summary. They are NOT stuck and the canary must not
		// page on them — there are still some left in production from the
		// pre-state-machine era and they will only fully migrate when each
		// is touched again.
		const result = checkTerminalState({
			summaryStatus: undefined,
			crawlStatus: undefined,
			summary: "backfilled summary",
		});
		assert.deepStrictEqual(result, { terminal: true });
	});
});
