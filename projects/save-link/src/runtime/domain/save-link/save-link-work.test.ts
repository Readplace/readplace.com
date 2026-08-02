import { noopLogger } from "@packages/hutch-logger";
import { markCrawlBlocked, markCrawlNotFound } from "@packages/domain/article-aggregate";
import { initSaveLinkWork } from "./save-link-work";
import type { CrawlAndFinalizeArticle } from "@packages/finalize-article";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";

const notFoundCrawl = (httpStatus: 404 | 410): CrawlAndFinalizeArticle => async () => ({ status: "not-found", httpStatus });

const blockedCrawl = (httpStatus: number): CrawlAndFinalizeArticle => async () => ({ status: "blocked", httpStatus });

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
		const logCrawlOutcome = jest.fn();

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), readTierSnapshot, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/gone")).resolves.toBe("tier-1-terminal");
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/gone",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
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

	it("still reports the crawl failure as CrawlFailedError when the snapshot read throws, so the storage error cannot masquerade as an unclassified record failure", async () => {
		const logCrawlOutcome = jest.fn();
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });
		const readTierSnapshot = jest.fn().mockRejectedValue(new Error("KeyTooLongError: Your key is too long"));

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, readTierSnapshot, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/presigned.pdf")).rejects.toMatchObject({
			name: "CrawlFailedError",
		});
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/presigned.pdf",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
	});

	it("reports a parse-class failure to both telemetry sinks even when the terminal-state write fails, and still surfaces the persistence error", async () => {
		const logParseError = jest.fn();
		const logCrawlOutcome = jest.fn();
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "Readability returned null" });
		const transitionAndPersist = jest.fn().mockRejectedValue(new Error("conditional check failed"));

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, transitionAndPersist, logParseError, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/article")).rejects.toThrow("conditional check failed");
		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/article",
			reason: "Readability returned null",
		});
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/article",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
	});

	it("emits the failure outcome before the terminal-state write, so a persistence throw can no longer suppress the record", async () => {
		const logCrawlOutcome = jest.fn();
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "Readability returned null" });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, transitionAndPersist, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/article")).rejects.toThrow("crawl failed for https://example.com/article: Readability returned null");
		expect(logCrawlOutcome.mock.invocationCallOrder[0]).toBeLessThan(transitionAndPersist.mock.invocationCallOrder[0]);
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

	it("terminalises an edge-blocked link via markCrawlBlocked instead of throwing, so the record settles and the DLQ handler can never relabel it exhausted-retries", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedCrawl(403), transitionAndPersist });

		await expect(saveLinkWork("https://example.com/walled")).resolves.toBe("tier-1-terminal");
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
			url: "https://example.com/walled",
			input: { reason: { kind: "blocked", cause: "edge-block" } },
		});
	});

	it("records a 429 as rate-limited rather than an edge block, so the reader is not told to capture a page a later crawl can still fetch", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedCrawl(429), transitionAndPersist });

		await expect(saveLinkWork("https://example.com/throttled")).resolves.toBe("tier-1-terminal");
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlBlocked, {
			url: "https://example.com/throttled",
			input: { reason: { kind: "blocked", cause: "rate-limited" } },
		});
	});

	it("reports the edge block via logParseError with the HTTP status so the parse-errors dashboard separates blocks from crawler defects", async () => {
		const logParseError = jest.fn();

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedCrawl(429), logParseError });

		await saveLinkWork("https://example.com/walled");

		expect(logParseError).toHaveBeenCalledWith({
			url: "https://example.com/walled",
			reason: "crawl-blocked: HTTP 429",
		});
	});

	it("writes no tier source and defers nothing to the comprehensive crawl for an edge-blocked link — no persona change alters the Lambda's egress IP", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: blockedCrawl(403),
			putTierSource,
			updateFetchTimestamp,
			emitSimpleCrawlUnsupported,
		});

		await saveLinkWork("https://example.com/walled");

		expect(putTierSource).not.toHaveBeenCalled();
		expect(updateFetchTimestamp).not.toHaveBeenCalled();
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it("still resolves tier-1-terminal for an edge-blocked link when the tier-1 failure outcome log fails — a telemetry hiccup must not dead-letter a row that is already terminal", async () => {
		const readTierSnapshot = jest.fn().mockRejectedValue(new Error("DDB read timed out"));
		const logCrawlOutcome = jest.fn();

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedCrawl(403), readTierSnapshot, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/walled")).resolves.toBe("tier-1-terminal");
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://example.com/walled",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
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
