import assert from "node:assert/strict";
import { failedCrawlNotice } from "./failed-crawl-notice";

describe("failedCrawlNotice", () => {
	it.each([
		[JSON.stringify({ kind: "parse-error", detail: "no readable article candidate" }), "failed"],
		[JSON.stringify({ kind: "fetch-failed" }), "failed"],
		[JSON.stringify({ kind: "fetch-failed", httpStatus: 503 }), "failed"],
		[JSON.stringify({ kind: "exhausted-retries", receiveCount: 4 }), "failed"],
		[JSON.stringify({ kind: "blocked", cause: "spend-capped" }), "failed"],
		[JSON.stringify({ kind: "blocked", cause: "robots" }), "failed"],
		[JSON.stringify({ kind: "blocked", cause: "cloudflare" }), "failed"],
		["exceeded SQS maxReceiveCount", "failed"],
		[JSON.stringify({ kind: "blocked", cause: "edge-block" }), "blocked"],
		[JSON.stringify({ kind: "blocked", cause: "rate-limited" }), "blocked"],
		[JSON.stringify({ kind: "not-found", httpStatus: 404 }), "not-found"],
		[JSON.stringify({ kind: "not-found", httpStatus: 410 }), "not-found"],
		[JSON.stringify({ kind: "origin-unreachable", httpStatus: 522 }), "origin-down"],
		[JSON.stringify({ kind: "origin-unreachable", httpStatus: 503 }), "origin-down"],
		[JSON.stringify({ kind: "origin-unreachable", code: "ETIMEDOUT" }), "origin-down"],
	])("maps the stored failure reason %s to the %s notice the reader sees", (reason, variant) => {
		assert.deepEqual(failedCrawlNotice(reason), { variant });
	});
});
