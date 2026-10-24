import assert from "node:assert/strict";
import { failedCrawlNotice } from "./failed-crawl-notice";

describe("failedCrawlNotice", () => {
	it.each([
		[JSON.stringify({ kind: "parse-error", detail: "no readable article candidate" }), "failed", "offered"],
		[JSON.stringify({ kind: "capture-unreadable", detail: "no readable article candidate" }), "capture-unreadable", "offered"],
		[JSON.stringify({ kind: "fetch-failed" }), "failed", "offered"],
		[JSON.stringify({ kind: "fetch-failed", httpStatus: 503 }), "failed", "offered"],
		[JSON.stringify({ kind: "exhausted-retries", receiveCount: 4 }), "failed", "offered"],
		[JSON.stringify({ kind: "blocked", cause: "spend-capped" }), "failed", "offered"],
		[JSON.stringify({ kind: "blocked", cause: "robots" }), "failed", "withheld"],
		[JSON.stringify({ kind: "blocked", cause: "cloudflare" }), "failed", "offered"],
		["exceeded SQS maxReceiveCount", "failed", "offered"],
		[JSON.stringify({ kind: "blocked", cause: "edge-block" }), "blocked", "offered"],
		[JSON.stringify({ kind: "blocked", cause: "rate-limited" }), "blocked", "offered"],
		[JSON.stringify({ kind: "not-found", httpStatus: 404 }), "not-found", "withheld"],
		[JSON.stringify({ kind: "not-found", httpStatus: 410 }), "not-found", "withheld"],
		[JSON.stringify({ kind: "origin-unreachable", httpStatus: 522 }), "origin-down", "withheld"],
		[JSON.stringify({ kind: "origin-unreachable", httpStatus: 503 }), "origin-down", "withheld"],
		[JSON.stringify({ kind: "origin-unreachable", code: "ETIMEDOUT" }), "origin-down", "withheld"],
	])(
		"maps the stored failure reason %s to the %s notice with the capture rescue %s",
		(reason, variant, captureRescue) => {
			assert.deepEqual(failedCrawlNotice(reason), { variant, captureRescue });
		},
	);
});
