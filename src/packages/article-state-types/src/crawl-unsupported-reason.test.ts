import assert from "node:assert/strict";
import { CrawlUnsupportedReasonSchema } from "./crawl-unsupported-reason";

describe("CrawlUnsupportedReasonSchema", () => {
	it("accepts non-html-content with contentType", () => {
		const parsed = CrawlUnsupportedReasonSchema.parse({
			kind: "non-html-content",
			contentType: "application/pdf",
		});
		assert.deepEqual(parsed, {
			kind: "non-html-content",
			contentType: "application/pdf",
		});
	});

	it("accepts paywall (no payload)", () => {
		const parsed = CrawlUnsupportedReasonSchema.parse({ kind: "paywall" });
		assert.deepEqual(parsed, { kind: "paywall" });
	});

	it("accepts javascript-required (no payload)", () => {
		const parsed = CrawlUnsupportedReasonSchema.parse({ kind: "javascript-required" });
		assert.deepEqual(parsed, { kind: "javascript-required" });
	});

	it("accepts content-too-large with bytes", () => {
		const parsed = CrawlUnsupportedReasonSchema.parse({
			kind: "content-too-large",
			bytes: 50_000_000,
		});
		assert.deepEqual(parsed, { kind: "content-too-large", bytes: 50_000_000 });
	});

	it("rejects unknown kinds", () => {
		assert.throws(() =>
			CrawlUnsupportedReasonSchema.parse({ kind: "wat" }),
		);
	});
});
