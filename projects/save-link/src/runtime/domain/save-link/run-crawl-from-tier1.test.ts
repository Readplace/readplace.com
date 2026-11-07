import { noopLogger } from "@packages/logger";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import type { CrawlAndFinalizeArticle, CrawlAndFinalizeResult } from "@packages/finalize-article";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import { initRunCrawlFromTier1, type RunCrawlFromTier1Deps } from "./run-crawl-from-tier1";

const URL = "https://example.com/article";
const ATTEMPT = SaveAttemptIdSchema.parse("attempt-1");

const fetchedResult: CrawlAndFinalizeResult = {
	status: "fetched",
	article: {
		html: "<p>Article content</p>",
		metadata: { title: "Test", siteName: "example.com", excerpt: "test", wordCount: 10, estimatedReadTime: 1, imageUrl: undefined },
	},
	evaluationHtml: "<p>Article content</p>",
	bodyHash: "a".repeat(64),
};

function createRun(overrides: Partial<RunCrawlFromTier1Deps> = {}) {
	const unsupported: Array<Parameters<EmitSimpleCrawlUnsupported>[0]> = [];
	const run = initRunCrawlFromTier1({
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		resolveOriginalUrl: async (url) => url,
		crawlAndFinalizeArticle: async () => fetchedResult,
		emitSimpleCrawlUnsupported: async (params) => {
			unsupported.push(params);
		},
		putTierSource: async (params) => params.metadata,
		updateFetchTimestamp: async () => {},
		transitionAndPersist: async () => {},
		markCrawlStage: async () => {},
		adoptCanonicalIdentity: async () => {},
		isSiteRuleUrl: () => false,
		publishEvent: async () => {},
		now: () => new Date("2026-11-05T10:00:00.000Z"),
		logger: noopLogger,
		logParseError: () => {},
		logCrawlOutcome: () => {},
		readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		findContentSourceUrl: async () => undefined,
		logPrefix: "[Test]",
		...overrides,
	});
	return { run, unsupported };
}

describe("initRunCrawlFromTier1", () => {
	it("returns the live tier-1 candidate when the article has no content source", async () => {
		const { run } = createRun();

		const result = await run({ url: URL, saveAttemptId: ATTEMPT, recrawl: false, sourceOriginalUrl: undefined });

		expect(result).toEqual({ candidates: [{ id: expect.any(String), tier: "tier-1" }], liveAttempt: { outcome: "body" } });
	});

	it("returns nothing when the live crawl defers, having published the unsupported event", async () => {
		const blocked: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403 });
		const { run, unsupported } = createRun({ crawlAndFinalizeArticle: blocked });

		const result = await run({ url: URL, saveAttemptId: ATTEMPT, recrawl: false, sourceOriginalUrl: undefined });

		expect(result).toBeUndefined();
		expect(unsupported).toEqual([expect.objectContaining({ url: URL, recrawl: false, saveAttemptId: ATTEMPT })]);
	});

	it("crawls the content source alongside the live page when the article has one", async () => {
		const { run } = createRun({ findContentSourceUrl: async () => "https://archive.example/capture" });

		const result = await run({ url: URL, saveAttemptId: ATTEMPT, recrawl: true, sourceOriginalUrl: URL });

		expect(result).toEqual(expect.objectContaining({ liveAttempt: { outcome: "body" } }));
	});

	it("returns nothing when the capture pass defers to the unsupported policy", async () => {
		const blocked: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403 });
		const { run, unsupported } = createRun({ crawlAndFinalizeArticle: blocked, findContentSourceUrl: async () => "https://archive.example/capture" });

		const result = await run({ url: URL, saveAttemptId: ATTEMPT, recrawl: true, sourceOriginalUrl: URL });

		expect(result).toBeUndefined();
		expect(unsupported).toEqual([expect.objectContaining({ url: URL, recrawl: true })]);
	});
});
