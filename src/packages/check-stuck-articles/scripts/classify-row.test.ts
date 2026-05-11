import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRow } from "./classify-row";

describe("classifyRow", () => {
	describe("summaryStatus", () => {
		it("returns summary-pending for pending", () => {
			const reasons = classifyRow({ summaryStatus: "pending", crawlStatus: "ready", summary: undefined });
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns summary-failed for failed", () => {
			const reasons = classifyRow({ summaryStatus: "failed", crawlStatus: "ready", summary: undefined });
			assert.deepStrictEqual(reasons, ["summary-failed"]);
		});

		it("returns no reason for ready when summary text is present", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "ready", summary: "the summary" });
			assert.deepStrictEqual(reasons, []);
		});

		it("returns summary-ready-without-text when status=ready but the text is missing", () => {
			// Why this matters: this is the smoking-gun state the
			// fagnerbrack.com/why-developers-become-frustrated-… row was left
			// in after the 2026-05-10 freshness refresh — summaryStatus="ready"
			// but `summary` removed by the UpdateExpression. The original
			// FilterExpression only matched (pending|failed) statuses and
			// "all-fields-absent" legacy stubs, so the canary missed this
			// entire class of stuck row. The reason name is in the report
			// body the @claude tracking issue prints, so it is also the
			// single string operators search for when triaging this regression.
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "ready", summary: undefined });
			assert.deepStrictEqual(reasons, ["summary-ready-without-text"]);
		});

		it("returns no reason for skipped", () => {
			const reasons = classifyRow({ summaryStatus: "skipped", crawlStatus: "ready", summary: undefined });
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("crawlStatus", () => {
		it("returns crawl-pending for pending", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "pending", summary: "the summary" });
			assert.deepStrictEqual(reasons, ["crawl-pending"]);
		});

		it("returns crawl-failed for failed", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "failed", summary: "the summary" });
			assert.deepStrictEqual(reasons, ["crawl-failed"]);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "ready", summary: "the summary" });
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("combined statuses", () => {
		it("returns both reasons when summary and crawl are pending", () => {
			const reasons = classifyRow({ summaryStatus: "pending", crawlStatus: "pending", summary: undefined });
			assert.deepStrictEqual(reasons, ["summary-pending", "crawl-pending"]);
		});

		it("returns both reasons when summary and crawl are failed", () => {
			const reasons = classifyRow({ summaryStatus: "failed", crawlStatus: "failed", summary: undefined });
			assert.deepStrictEqual(reasons, ["summary-failed", "crawl-failed"]);
		});
	});

	describe("legacy stub", () => {
		it("returns legacy-stub when all fields are undefined", () => {
			const reasons = classifyRow({ summaryStatus: undefined, crawlStatus: undefined, summary: undefined });
			assert.deepStrictEqual(reasons, ["legacy-stub"]);
		});

		it("returns no reason when summary exists but statuses are undefined", () => {
			const reasons = classifyRow({ summaryStatus: undefined, crawlStatus: undefined, summary: "some text" });
			assert.deepStrictEqual(reasons, []);
		});
	});
});
