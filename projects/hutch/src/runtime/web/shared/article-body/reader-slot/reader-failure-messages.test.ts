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

	it("maps not-found to a page-no-longer-exists explanation carrying the status", () => {
		expect(
			messageForCrawlFailure({ kind: "not-found", httpStatus: 404 }),
		).toContain("HTTP 404");
	});

	it("maps blocked/edge-block to an explanation naming the browser-capture recovery", () => {
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "edge-block" }),
		).toContain("Open it in your browser");
	});

	it("maps blocked/robots to a robots.txt explanation", () => {
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "robots" }),
		).toContain("robots.txt");
	});

	it("maps blocked/spend-capped to our own processing limit, never blaming the site for a cap we set", () => {
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "spend-capped" }),
		).toContain("our own processing limit");
	});

	it("gives blocked/rate-limited the same recovery copy as an edge block — the reader is told what to do, and only the stored cause distinguishes them", () => {
		expect(messageForCrawlFailure({ kind: "blocked", cause: "rate-limited" })).toBe(
			messageForCrawlFailure({ kind: "blocked", cause: "edge-block" }),
		);
		expect(
			messageForCrawlFailure({ kind: "blocked", cause: "rate-limited" }),
		).toContain("Open it in your browser");
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
