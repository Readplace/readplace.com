import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyRow } from "./classify-row";

describe("classifyRow", () => {
	describe("summaryStatus", () => {
		it("returns summary-pending for pending", () => {
			const reasons = classifyRow({ summaryStatus: "pending", crawlStatus: "ready" });
			assert.deepStrictEqual(reasons, ["summary-pending"]);
		});

		it("returns no reason for failed (terminal — operator owns recovery via /admin/recrawl, DLQ alarm is the signal)", () => {
			const reasons = classifyRow({ summaryStatus: "failed", crawlStatus: "ready" });
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "ready" });
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for skipped", () => {
			const reasons = classifyRow({ summaryStatus: "skipped", crawlStatus: "ready" });
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("crawlStatus", () => {
		it("returns crawl-pending for pending", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "pending" });
			assert.deepStrictEqual(reasons, ["crawl-pending"]);
		});

		it("returns no reason for failed (terminal — DLQ → email is the redrive signal)", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "failed" });
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for unsupported (terminal — non-html origin, no recovery to drive)", () => {
			const reasons = classifyRow({ summaryStatus: "skipped", crawlStatus: "unsupported" });
			assert.deepStrictEqual(reasons, []);
		});

		it("returns no reason for ready", () => {
			const reasons = classifyRow({ summaryStatus: "ready", crawlStatus: "ready" });
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("combined statuses", () => {
		it("returns both reasons when summary and crawl are pending", () => {
			const reasons = classifyRow({ summaryStatus: "pending", crawlStatus: "pending" });
			assert.deepStrictEqual(reasons, ["summary-pending", "crawl-pending"]);
		});

		it("returns no reasons when summary and crawl are both terminal failures", () => {
			const reasons = classifyRow({ summaryStatus: "failed", crawlStatus: "failed" });
			assert.deepStrictEqual(reasons, []);
		});
	});

	describe("undefined statuses", () => {
		it("returns no reasons when both statuses are undefined (canary only flags pending — terminal absence is not stuck)", () => {
			const reasons = classifyRow({ summaryStatus: undefined, crawlStatus: undefined });
			assert.deepStrictEqual(reasons, []);
		});
	});
});
