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
			});
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns no reason for failed (terminal — operator owns recovery via /admin/recrawl, DLQ alarm is the signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
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
			});
			assert.deepStrictEqual(reasons, ["crawl-pending"]);
		});

		it("returns no reason for failed (terminal — DLQ → email is the redrive signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "failed",
				aggregateTransitionName: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for unsupported (terminal — non-html origin, no recovery to drive)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "unsupported",
				aggregateTransitionName: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
				aggregateTransitionName: undefined,
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
			});
			assert.deepStrictEqual(reasons, ["summary-pending", "crawl-pending"]);
		});

		it("returns no reasons when summary and crawl are both terminal failures", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "failed",
				aggregateTransitionName: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("undefined statuses", () => {
		it("returns no reasons when both statuses are undefined (canary only flags pending — terminal absence is not stuck)", () => {
			const reasons = classifyRow({
				summaryStatus: undefined,
				crawlStatus: undefined,
				aggregateTransitionName: undefined,
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
			});
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns no reasons when the migrated transition succeeded (failed crawl is terminal, not stuck)", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "failed",
				aggregateTransitionName: "markCrawlExhausted",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("emits both axes with -after-aggregate-migration when both are pending under a migrated writer", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "pending",
				aggregateTransitionName: "markCrawlExhausted",
			});
			assert.deepStrictEqual(reasons, [
				"summary-pending-after-aggregate-migration",
				"crawl-pending-after-aggregate-migration",
			]);
		});
	});
});
