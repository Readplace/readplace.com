import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRow } from "./classify-row";

describe("classifyRow", () => {
	describe("summaryStatus", () => {
		it("returns summary-pending for pending", () => {
			const reasons = classifyRow({
				summaryStatus: "pending",
				crawlStatus: "ready",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns no reason for failed (terminal — operator owns recovery via /admin/recrawl, DLQ alarm is the signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "ready",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped with content-too-short (PR #320 tie path is the recovery; pure retry no-ops)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "ready",
				summarySkippedReason: "content-too-short",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped with crawl-unsupported (URL type unsupported, retry never helps)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "unsupported",
				summarySkippedReason: "crawl-unsupported",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped with no recorded reason (legacy row, defaults to no retry-owed signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "ready",
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
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["crawl-pending"]);
		});

		it("returns no reason for failed (terminal — DLQ → email is the redrive signal)", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "failed",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for unsupported (terminal — non-html origin, no recovery to drive)", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "unsupported",
				summarySkippedReason: "crawl-unsupported",
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
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
				summarySkippedReason: "ai-unavailable",
			});
			assert.deepStrictEqual(reasons, ["summary-skipped-ai-unavailable"]);
		});

		it("does NOT emit ai-unavailable when summaryStatus is ready (defensive — reason attribute should be cleared on transition out of skipped)", () => {
			const reasons = classifyRow({
				summaryStatus: "ready",
				crawlStatus: "ready",
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
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, ["summary-pending", "crawl-pending"]);
		});

		it("returns no reasons when summary and crawl are both terminal failures", () => {
			const reasons = classifyRow({
				summaryStatus: "failed",
				crawlStatus: "failed",
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});

		it("returns crawl-pending and summary-skipped-ai-unavailable when crawl is in flight while a prior summary attempt was skipped on AI down", () => {
			const reasons = classifyRow({
				summaryStatus: "skipped",
				crawlStatus: "pending",
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
				summarySkippedReason: undefined,
			});
			assert.deepStrictEqual(reasons, []);
		});
	});
});
