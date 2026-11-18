import assert from "node:assert/strict";
import type { Logger } from "@packages/logger";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";
import { REFUSED_CONNECTION_RETRY_DELAY_MS, withRefusedConnectionRetry } from "./retry-refused-connection";

const ORIGINAL = "https://www.example.com/article";
const CAPTURE = "https://web.archive.org/web/https://www.example.com/article";

const refused: CrawlAndFinalizeResult = {
	status: "failed",
	decision: undefined,
	reason: "crawl-failed",
	failure: { kind: "origin-unreachable", code: "ECONNREFUSED" },
};

const fetched: CrawlAndFinalizeResult = {
	status: "fetched",
	httpStatus: 200,
	bodyHash: "hash",
	article: {
		html: "<p>From the archive</p>",
		metadata: { title: "T", siteName: "example.com", excerpt: "e", wordCount: 300, estimatedReadTime: 2, imageUrl: undefined },
	},
	evaluationHtml: "<html><body><p>From the archive</p></body></html>",
};

function createCrawl(results: CrawlAndFinalizeResult[]) {
	const crawls: Parameters<CrawlAndFinalizeArticle>[0][] = [];
	const delays: number[] = [];
	const warns: unknown[][] = [];
	const logger: Logger = {
		info: () => {},
		warn: (...args) => warns.push(args),
		error: () => {},
		debug: () => {},
	};
	const crawl = withRefusedConnectionRetry({
		crawlAndFinalizeArticle: async (params) => {
			crawls.push(params);
			const result = results[crawls.length - 1];
			assert(result, "crawled more often than the test expects");
			return result;
		},
		delay: async (milliseconds) => {
			delays.push(milliseconds);
		},
		logger,
	});
	const params = { writeContext: { url: ORIGINAL, attemptId: SaveAttemptIdSchema.parse("6f1c2a4e-1b9d-4c7a-9e2f-3a5b7c9d1e2f") }, url: ORIGINAL, fetchUrl: CAPTURE, retainResponseBody: true };
	return { crawl, crawls, delays, warns, params };
}

describe("withRefusedConnectionRetry", () => {
	it("crawls again after a pause when the origin refused the connection, and returns the second result", async () => {
		const { crawl, crawls, delays, warns, params } = createCrawl([refused, fetched]);

		const result = await crawl(params);

		assert.equal(result, fetched);
		assert.deepEqual(crawls, [params, params]);
		assert.deepEqual(delays, [REFUSED_CONNECTION_RETRY_DELAY_MS]);
		assert.deepEqual(warns, [["[ArchiveCapture] connection refused, retrying once", { url: ORIGINAL, fetchUrl: CAPTURE }]]);
	});

	it("retries only once when the origin refuses the connection again", async () => {
		const { crawl, crawls, delays, params } = createCrawl([refused, refused]);

		const result = await crawl(params);

		assert.equal(result, refused);
		assert.equal(crawls.length, 2);
		assert.deepEqual(delays, [REFUSED_CONNECTION_RETRY_DELAY_MS]);
	});

	it("does not retry a failure that is not a refused connection", async () => {
		const unavailable: CrawlAndFinalizeResult = { status: "failed", decision: undefined, reason: "crawl-failed", failure: { kind: "origin-unreachable", httpStatus: 503 } };
		const { crawl, crawls, delays, params } = createCrawl([unavailable]);

		const result = await crawl(params);

		assert.equal(result, unavailable);
		assert.equal(crawls.length, 1);
		assert.deepEqual(delays, []);
	});

	it("does not retry a failure the crawler could not classify", async () => {
		const unclassified: CrawlAndFinalizeResult = { status: "failed", decision: undefined, reason: "crawl-failed" };
		const { crawl, crawls, delays, params } = createCrawl([unclassified]);

		await crawl(params);

		assert.equal(crawls.length, 1);
		assert.deepEqual(delays, []);
	});

	it("does not pause when the first crawl fetched the page", async () => {
		const { crawl, crawls, delays, params } = createCrawl([fetched]);

		const result = await crawl(params);

		assert.equal(result, fetched);
		assert.equal(crawls.length, 1);
		assert.deepEqual(delays, []);
	});
});
