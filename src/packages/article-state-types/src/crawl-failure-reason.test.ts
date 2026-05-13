import assert from "node:assert/strict";
import { CrawlFailureReasonSchema } from "./crawl-failure-reason";

describe("CrawlFailureReasonSchema", () => {
	it("accepts parse-error with detail", () => {
		const parsed = CrawlFailureReasonSchema.parse({
			kind: "parse-error",
			detail: "missing <article>",
		});
		assert.deepEqual(parsed, { kind: "parse-error", detail: "missing <article>" });
	});

	it("accepts fetch-failed with optional httpStatus", () => {
		const parsed = CrawlFailureReasonSchema.parse({
			kind: "fetch-failed",
			httpStatus: 503,
		});
		assert.deepEqual(parsed, { kind: "fetch-failed", httpStatus: 503 });

		const without = CrawlFailureReasonSchema.parse({ kind: "fetch-failed" });
		assert.deepEqual(without, { kind: "fetch-failed" });
	});

	it("accepts exhausted-retries with receiveCount", () => {
		const parsed = CrawlFailureReasonSchema.parse({
			kind: "exhausted-retries",
			receiveCount: 4,
		});
		assert.deepEqual(parsed, { kind: "exhausted-retries", receiveCount: 4 });
	});

	it("accepts blocked with cause", () => {
		const parsed = CrawlFailureReasonSchema.parse({
			kind: "blocked",
			cause: "cloudflare",
		});
		assert.deepEqual(parsed, { kind: "blocked", cause: "cloudflare" });
	});

	it("rejects unknown kinds", () => {
		assert.throws(() =>
			CrawlFailureReasonSchema.parse({ kind: "what-now", detail: "x" }),
		);
	});

	it("rejects blocked with unsupported cause", () => {
		assert.throws(() =>
			CrawlFailureReasonSchema.parse({ kind: "blocked", cause: "captcha" }),
		);
	});
});
