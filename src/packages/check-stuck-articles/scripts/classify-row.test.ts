import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRow } from "./classify-row";

describe("classifyRow", () => {
	describe("summaryStatus", () => {
		it("returns summary-pending for pending", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns no reason for failed (terminal — operator owns recovery via /admin/recrawl, DLQ alarm is the signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped with content-too-short (PR #320 tie path is the recovery; pure retry no-ops)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: "content-too-short",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped with crawl-unsupported (URL type unsupported, retry never helps)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "unsupported",
				aggregateTransitionName: undefined,
				summarySkippedReason: "crawl-unsupported",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped with no recorded reason (legacy row, defaults to no retry-owed signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("crawlStatus", () => {
		it("returns crawl-pending for pending", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "pending",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["crawl-pending"]);
		});

		it("returns no reason for failed (terminal — DLQ → email is the redrive signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "failed",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for unsupported (terminal — non-html origin, no recovery to drive)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "unsupported",
				aggregateTransitionName: undefined,
				summarySkippedReason: "crawl-unsupported",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("summary skipped ai-unavailable", () => {
		it("returns summary-skipped-ai-unavailable when the summariser recorded the AI as down (no auto-heal fires for skipped, manual recrawl is the only recovery)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: "ai-unavailable",
			});
			assert.deepStrictEqual(reasons, ["summary-skipped-ai-unavailable"]);
		});

		it("does NOT emit ai-unavailable when summaryStatus is ready (defensive — reason attribute should be cleared on transition out of skipped)", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
				summarySkippedReason: "ai-unavailable",
			});
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("combined statuses", () => {
		it("returns both reasons when summary and crawl are pending", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "pending",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["summary-pending", "crawl-pending"]);
		});

		it("returns no reasons when summary and crawl are both terminal failures", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "failed",
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns crawl-pending and summary-skipped-ai-unavailable when crawl is in flight while a prior summary attempt was skipped on AI down", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "pending",
				aggregateTransitionName: undefined,
				summarySkippedReason: "ai-unavailable",
			});
			assert.deepStrictEqual(reasons, [
				"crawl-pending",
				"summary-skipped-ai-unavailable",
			]);
		});
	});

	describe("undefined statuses", () => {
		it("returns no reasons when both statuses are undefined (canary only flags pending and skipped-ai-unavailable — terminal absence is not stuck)", () => {
			const reasons = classifyRow({
				summaryStatus: undefined,
				crawlStatus: undefined,
				aggregateTransitionName: undefined,
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("Phase 2 cross-axis writer migration", () => {
		it("flips a summary-pending row written by markCrawlExhausted to the -after-aggregate-migration variant", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "ready",
				aggregateTransitionName: "markCrawlExhausted",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, [
				"summary-pending-after-aggregate-migration",
			]);
		});

		it("flips a crawl-pending row written by recrawlTieKeptCanonical to the -after-aggregate-migration variant", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "pending",
				aggregateTransitionName: "recrawlTieKeptCanonical",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, [
				"crawl-pending-after-aggregate-migration",
			]);
		});

		it("flips a crawl-pending row written by recrawlPromoteTier to the -after-aggregate-migration variant", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "pending",
				aggregateTransitionName: "recrawlPromoteTier",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, [
				"crawl-pending-after-aggregate-migration",
			]);
		});

		it("does NOT flip a row written by refreshContent (Phase 1 — not in the Phase 2 bet)", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "ready",
				aggregateTransitionName: "refreshContent",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns no reasons when the migrated transition succeeded (failed crawl is terminal, not stuck)", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "failed",
				aggregateTransitionName: "markCrawlExhausted",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("emits both axes with -after-aggregate-migration when both are pending under a migrated writer", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "pending",
				aggregateTransitionName: "markCrawlExhausted",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, [
				"summary-pending-after-aggregate-migration",
				"crawl-pending-after-aggregate-migration",
			]);
		});
	});
});
