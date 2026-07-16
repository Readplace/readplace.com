import { noopLogger } from "@packages/hutch-logger";
import { markCrawlNotFound } from "@packages/domain/article-aggregate";
import { initSaveLinkWork } from "./save-link-work";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

const notFoundCrawl = (httpStatus: 404 | 410): CrawlAndFinalizeArticle => async () => ({ status: "not-found", httpStatus });

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

type WorkDeps = Parameters<typeof initSaveLinkWork>[0];

const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createWork(overrides: Partial<WorkDeps> = {}) {
	return initSaveLinkWork({
		crawlAndFinalizeArticle: notFoundCrawl(404),
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		now: fixedNow,
		logger: noopLogger,
		logParseError: jest.fn(),
		logCrawlOutcome: jest.fn(),
		readTierSnapshot: jest.fn().mockResolvedValue({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
		logPrefix: "[save-link-work.test]",
		...overrides,
	});
}

describe("initSaveLinkWork", () => {
	it("resolves tier-1-terminal instead of throwing for a permanently-dead link (HTTP 410) — an SQS retry can never revive a page the origin no longer serves", async () => {
		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(410) });

		await expect(saveLinkWork("https://example.com/gone")).resolves.toBe("tier-1-terminal");
	});

	it("still resolves tier-1-terminal when the tier-1 failure outcome log fails — a telemetry hiccup must not dead-letter a message whose row is already terminal", async () => {
		const readTierSnapshot = jest.fn().mockRejectedValue(new Error("DDB read timed out"));

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), readTierSnapshot });

		await expect(saveLinkWork("https://example.com/gone")).resolves.toBe("tier-1-terminal");
	});

	it("terminalises both axes atomically via markCrawlNotFound so the dead link never lands on the retry → DLQ → exhausted-retries path that would mislabel it as a crawler defect", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), transitionAndPersist });

		await saveLinkWork("https://example.com/gone");

		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
	});

	it("reports the dead link via logParseError with the HTTP status so the parse-errors dashboard distinguishes gone pages from crawler defects", async () => {
		const logParseError = jest.fn();

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), logParseError });

		await saveLinkWork("https://example.com/gone");

		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/gone",
			reason: "crawl-not-found: HTTP 404",
		});
	});

	it("emits a tier-1 failure crawl-outcome for the dead link, reflecting the other tier's snapshot at emission time", async () => {
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), logCrawlOutcome, readTierSnapshot });

		await saveLinkWork("https://example.com/gone");

		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/gone",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "success",
			pickedTier: "tier-0",
		});
	});

	it("writes no tier source, records no fetch timestamp, and defers nothing to the comprehensive crawl — there is no content for a selector to pick from a page the origin no longer serves", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: notFoundCrawl(404),
			putTierSource,
			updateFetchTimestamp,
			emitSimpleCrawlUnsupported,
		});

		await saveLinkWork("https://example.com/gone");

		expect(putTierSource).not.toHaveBeenCalled();
		expect(updateFetchTimestamp).not.toHaveBeenCalled();
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it("hands the redirect terminal + word count to adoptCanonicalIdentity after a successful tier-1 write", async () => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const fetchedCrawl: CrawlAndFinalizeArticle = async () => ({
			status: "fetched",
			article: {
				html: "<p>body</p>",
				metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 321, estimatedReadTime: 2 },
			},
			finalUrl: "https://site.com/page",
			bodyHash: "b".repeat(64),
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: fetchedCrawl, adoptCanonicalIdentity });

		const result = await saveLinkWork("https://site.com/page.html", { userId: "u1" });

		expect(result).toBe("tier-1-written");
		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://site.com/page.html",
			finalUrl: "https://site.com/page",
			wordCount: 321,
			recrawl: undefined,
		});
	});
});
