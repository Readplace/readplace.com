import {
	messageForCrawlFailure,
	messageForCrawlUnsupported,
} from "./reader-failure-messages";

describe("messageForCrawlFailure", () => {
	it("maps parse-error to a server-side parse explanation", () => {
		expect(
			messageForCrawlFailure({
				kind: "parse-error",
				detail: "Readability null",
			}),
		).toContain("extract");
	});

	it("maps fetch-failed without httpStatus to a generic host-unreachable message", () => {
		expect(messageForCrawlFailure({ kind: "fetch-failed" })).toContain(
			"couldn't reach",
		);
	});

	it("maps fetch-failed with httpStatus to a specific HTTP-error message", () => {
		expect(
			messageForCrawlFailure({ kind: "fetch-failed", httpStatus: 503 }),
		).toContain("HTTP 503");
	});

	it("maps exhausted-retries to a retry-exhausted explanation", () => {
		expect(
			messageForCrawlFailure({ kind: "exhausted-retries", receiveCount: 4 }),
		).toContain("retried");
	});

	it("maps blocked/cloudflare to a Cloudflare-specific explanation", () => {
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "cloudflare" }),
		).toContain("Cloudflare");
	});

	it("maps blocked/robots to a robots.txt explanation", () => {
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "robots" }),
		).toContain("robots.txt");
	});

	it("maps blocked/rate-limited to a rate-limit explanation", () => {
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "rate-limited" }),
		).toContain("rate-limited");
	});
});

describe("messageForCrawlUnsupported", () => {
	it("maps non-html-content with content type", () => {
		expect(
			messageForCrawlUnsupported({
				kind: "non-html-content",
				contentType: "application/pdf",
			}),
		).toContain("application/pdf");
	});

	it("maps paywall to a paywall explanation", () => {
		expect(messageForCrawlUnsupported({ kind: "paywall" })).toContain(
			"paywall",
		);
	});

	it("maps javascript-required to a JS explanation", () => {
		expect(
			messageForCrawlUnsupported({ kind: "javascript-required" }),
		).toContain("JavaScript");
	});

	it("maps content-too-large to a size explanation", () => {
		expect(
			messageForCrawlUnsupported({ kind: "content-too-large", bytes: 50_000_000 }),
		).toContain("too large");
	});
});
