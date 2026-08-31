import { crawlFailureReasonForError } from "./crawl-failure-reason-for-error";
import { ClassifiedCrawlError } from "./save-link-work";

describe("crawlFailureReasonForError", () => {
	it("returns the transport failure the crawl error already classified, so a first-receive failure is not reported as an exhausted retry budget", () => {
		const error = new ClassifiedCrawlError({
			url: "https://example.com/article",
			message: "crawl failed for https://example.com/article: crawl-failed",
			crawlFailureReason: { kind: "fetch-failed" },
		});

		expect(crawlFailureReasonForError({ error, receiveCount: 1 })).toEqual({ kind: "fetch-failed" });
	});

	it("carries a parse failure's detail through, so the diagnosis the worker already wrote is not overwritten", () => {
		const error = new ClassifiedCrawlError({
			url: "https://example.com/article",
			message: "crawl failed for https://example.com/article: Readability returned null",
			crawlFailureReason: { kind: "parse-error", detail: "Readability returned null" },
		});

		expect(crawlFailureReasonForError({ error, receiveCount: 1 })).toEqual({
			kind: "parse-error",
			detail: "Readability returned null",
		});
	});

	it("falls back to the record's receive count for an error the crawl never classified", () => {
		expect(
			crawlFailureReasonForError({ error: new Error("S3 PutObject failed"), receiveCount: 3 }),
		).toEqual({ kind: "exhausted-retries", receiveCount: 3 });
	});
});
