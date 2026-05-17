import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkTerminalState } from "./check-terminal-state";

describe("checkTerminalState", () => {
	it("returns terminal:true when both state machines are ready", () => {
		const result = checkTerminalState({
			summaryStatus: "ready",
			crawlStatus: "ready",
			aggregateTransitionName: undefined,
			summarySkippedReason: undefined,
		});
		assert.deepStrictEqual(result, { terminal: true });
	});

	it("returns terminal:true when the summary was deliberately skipped for content-too-short (PR #320 tie path is the recovery)", () => {
		const result = checkTerminalState({
			summaryStatus: "skipped",
			crawlStatus: "ready",
			aggregateTransitionName: undefined,
			summarySkippedReason: "content-too-short",
		});
		assert.deepStrictEqual(result, { terminal: true });
	});

	it("returns terminal:false with the ai-unavailable message when the summariser recorded AI as down", () => {
		const result = checkTerminalState({
			summaryStatus: "skipped",
			crawlStatus: "ready",
			aggregateTransitionName: undefined,
			summarySkippedReason: "ai-unavailable",
		});
		assert.equal(result.terminal, false);
		assert.match(
			result.terminal === false ? result.message : "",
			/ai-unavailable.*no auto-heal fires for skipped/,
		);
	});

	it("returns terminal:false with the summary-pending message when summaryStatus=pending", () => {
		const result = checkTerminalState({
			summaryStatus: "pending",
			crawlStatus: "ready",
			aggregateTransitionName: undefined,
			summarySkippedReason: undefined,
		});
		assert.deepStrictEqual(result, {
			terminal: false,
			message: "summaryStatus is 'pending' — summary worker never produced a terminal outcome",
		});
	});

	it("concatenates messages when both axes are pending", () => {
		const result = checkTerminalState({
			summaryStatus: "pending",
			crawlStatus: "pending",
			aggregateTransitionName: undefined,
			summarySkippedReason: undefined,
		});
		assert.equal(result.terminal, false);
		assert.equal(
			result.terminal === false ? result.message : "",
			"summaryStatus is 'pending' — summary worker never produced a terminal outcome; crawlStatus is 'pending' — crawl worker never produced a terminal outcome",
		);
	});

	it("treats crawl/summary terminal failures as terminal (operator owns recovery via /admin/recrawl)", () => {
		const failedCrawl = checkTerminalState({
			summaryStatus: "ready",
			crawlStatus: "failed",
			aggregateTransitionName: undefined,
			summarySkippedReason: undefined,
		});
		assert.deepStrictEqual(failedCrawl, { terminal: true });

		const unsupportedCrawl = checkTerminalState({
			summaryStatus: "skipped",
			crawlStatus: "unsupported",
			aggregateTransitionName: undefined,
			summarySkippedReason: "crawl-unsupported",
		});
		assert.deepStrictEqual(unsupportedCrawl, { terminal: true });
	});

	it("returns terminal:true when both statuses are undefined (canary flags pending only, not absence)", () => {
		const result = checkTerminalState({
			summaryStatus: undefined,
			crawlStatus: undefined,
			aggregateTransitionName: undefined,
			summarySkippedReason: undefined,
		});
		assert.deepStrictEqual(result, { terminal: true });
	});

	it("surfaces the -after-aggregate-migration message for a stuck row produced by a Phase 2 transition (falsifiable measurement)", () => {
		const result = checkTerminalState({
			summaryStatus: "ready",
			crawlStatus: "pending",
			aggregateTransitionName: "recrawlTieKeptCanonical",
			summarySkippedReason: undefined,
		});
		assert.equal(result.terminal, false);
		assert.match(
			result.terminal === false ? result.message : "",
			/Phase 2 aggregate transition/,
		);
	});
});
