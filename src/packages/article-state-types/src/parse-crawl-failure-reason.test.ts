import assert from "node:assert/strict";
import { parseCrawlFailureReason } from "./parse-crawl-failure-reason";

describe("parseCrawlFailureReason", () => {
	it("parses a stored reason back into its discriminated shape", () => {
		assert.deepEqual(parseCrawlFailureReason('{"kind":"blocked","cause":"edge-block"}'), {
			kind: "blocked",
			cause: "edge-block",
		});
	});

	it("returns undefined when the row carries no reason", () => {
		assert.equal(parseCrawlFailureReason(undefined), undefined);
	});

	it("returns undefined for a legacy bare-string reason", () => {
		assert.equal(parseCrawlFailureReason("crawl-failed"), undefined);
	});

	it("returns undefined for a kind this build does not know", () => {
		assert.equal(parseCrawlFailureReason('{"kind":"what-now","detail":"x"}'), undefined);
	});

	it("returns undefined for a row written under the retired cloudflare cause", () => {
		assert.equal(parseCrawlFailureReason('{"kind":"blocked","cause":"cloudflare"}'), undefined);
	});
});
