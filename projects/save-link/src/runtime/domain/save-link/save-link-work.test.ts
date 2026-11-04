import { UserIdSchema } from "@packages/domain/user";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { noopLogger } from "@packages/logger";
import { markCrawlFailed, markCrawlNotFound, markCrawlUnsupported } from "@packages/domain/article-aggregate";
import { ClassifiedCrawlError, initSaveLinkWork } from "./save-link-work";
import { type CrawlAndFinalizeArticle, type FinalizeArticle, initCrawlAndFinalizeArticle } from "@packages/finalize-article";
import { type CrawlArticle, initCrawlArticle, initFetchPinnedCrawl } from "@packages/crawl-article";
import type { AdoptArticleDestination } from "@packages/article-store";
import { initAdoptCanonicalIdentity } from "./adopt-canonical-identity";
import type { PutTierSource } from "@packages/tier-source";
import type { EmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import { candidateProvenance } from "@packages/tier-source";
import { deferJavascriptShells } from "./javascript-shell";

const notFoundCrawl = (httpStatus: 404 | 410): CrawlAndFinalizeArticle => async () => ({ status: "not-found", httpStatus });

const blockedCrawl = (httpStatus: number): CrawlAndFinalizeArticle => async () => ({ status: "blocked", httpStatus });

const rejectingEmitSimpleCrawlUnsupported: EmitSimpleCrawlUnsupported = async () => {
	throw new Error("emitSimpleCrawlUnsupported invoked unexpectedly");
};

type WorkDeps = Parameters<typeof initSaveLinkWork>[0];

const saveAttemptId = SaveAttemptIdSchema.parse("attempt-1");
const fixedNow = () => new Date("2026-04-18T12:00:00.000Z");

function createWork(overrides: Partial<WorkDeps> = {}) {
	return initSaveLinkWork({
		resolveOriginalUrl: async (url) => url,
		crawlAndFinalizeArticle: notFoundCrawl(404),
		emitSimpleCrawlUnsupported: rejectingEmitSimpleCrawlUnsupported,
		putTierSource: jest.fn().mockResolvedValue(undefined),
		publishEvent: jest.fn().mockResolvedValue(undefined),
		updateFetchTimestamp: jest.fn().mockResolvedValue(undefined),
		transitionAndPersist: jest.fn().mockResolvedValue(undefined),
		markCrawlStage: jest.fn().mockResolvedValue(undefined),
		adoptCanonicalIdentity: jest.fn().mockResolvedValue(undefined),
		isSiteRuleUrl: () => false,
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
	it.each<Awaited<ReturnType<CrawlAndFinalizeArticle>>>([
		{ status: "failed", reason: "crawl-failed" },
		{ status: "failed", reason: "parse failure" },
		{ status: "unsupported", reason: "oversized", unsupportedReason: { kind: "content-too-large", bytes: 100_000_000 } },
	])("leaves a paired archive attempt's terminal state to the combined selector after %j", async (result) => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: async () => result, transitionAndPersist });
		const pending = saveLinkWork("https://example.com/article", { saveAttemptId: SaveAttemptIdSchema.parse("paired-attempt"), deferUnsupported: true });
		if (result.status === "failed") await expect(pending).rejects.toBeInstanceOf(ClassifiedCrawlError);
		else await expect(pending).resolves.toBe("tier-1-terminal");
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});
	it("resolves tier-1-terminal instead of throwing for a permanently-dead link (HTTP 410) — an SQS retry can never revive a page the origin no longer serves", async () => {
		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(410) });

		await expect(saveLinkWork("https://example.com/gone", { saveAttemptId })).resolves.toBe("tier-1-terminal");
	});

	it("still resolves tier-1-terminal when the tier-1 failure outcome log fails — a telemetry hiccup must not dead-letter a message whose row is already terminal", async () => {
		const readTierSnapshot = jest.fn().mockRejectedValue(new Error("DDB read timed out"));
		const logCrawlOutcome = jest.fn();

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), readTierSnapshot, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/gone", { saveAttemptId })).resolves.toBe("tier-1-terminal");
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

		await saveLinkWork("https://example.com/gone", { saveAttemptId });

		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
	});

	it("keeps the dead link off the parse-errors stream, which the forwarder routes to the error dashboard regardless of level — the terminal row already records a gone page, and it is not a crawler defect", async () => {
		const logParseError = jest.fn();
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: notFoundCrawl(404),
			logParseError,
			transitionAndPersist,
		});

		await saveLinkWork("https://example.com/gone", { saveAttemptId });

		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, {
			url: "https://example.com/gone",
			input: { reason: { kind: "not-found", httpStatus: 404 } },
		});
		expect(logParseError).toHaveBeenCalledTimes(0);
	});

	it("emits a tier-1 failure crawl-outcome for the dead link, reflecting the other tier's snapshot at emission time", async () => {
		const logCrawlOutcome = jest.fn();
		const readTierSnapshot = jest.fn().mockResolvedValue({
			tier0Status: "success",
			tier1Status: "not_attempted",
			pickedTier: "tier-0",
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: notFoundCrawl(404), logCrawlOutcome, readTierSnapshot });

		await saveLinkWork("https://example.com/gone", { saveAttemptId });

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

		await expect(saveLinkWork("https://example.com/presigned.pdf", { saveAttemptId })).rejects.toMatchObject({
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

	it("persists the classified origin-unreachable reason via markCrawlFailed before the CrawlFailedError that dead-letters the record", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "failed",
			reason: "crawl-failed",
			failure: { kind: "origin-unreachable", httpStatus: 522 },
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, transitionAndPersist });

		await expect(saveLinkWork("https://example.com/article", { saveAttemptId })).rejects.toMatchObject({
			name: "CrawlFailedError",
			crawlFailureReason: { kind: "origin-unreachable", httpStatus: 522 },
		});
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, {
			url: "https://example.com/article",
			input: { reason: { kind: "origin-unreachable", httpStatus: 522 } },
		});
	});

	it("surfaces the inline write's error when the network-failure terminal-state write fails, so the record dead-letters and the DLQ handler still terminalises it", async () => {
		const transitionAndPersist = jest.fn().mockRejectedValue(new Error("conditional check failed"));
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed" });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, transitionAndPersist });

		await expect(saveLinkWork("https://example.com/article", { saveAttemptId })).rejects.toThrow("conditional check failed");
	});

	it("reports a parse-class failure to both telemetry sinks even when the terminal-state write fails, and still surfaces the persistence error", async () => {
		const logParseError = jest.fn();
		const logCrawlOutcome = jest.fn();
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "Readability returned null" });
		const transitionAndPersist = jest.fn().mockRejectedValue(new Error("conditional check failed"));

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, transitionAndPersist, logParseError, logCrawlOutcome });

		await expect(saveLinkWork("https://example.com/article", { saveAttemptId })).rejects.toThrow("conditional check failed");
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

		await expect(saveLinkWork("https://example.com/article", { saveAttemptId })).rejects.toThrow("crawl failed for https://example.com/article: Readability returned null");
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

		await saveLinkWork("https://example.com/gone", { saveAttemptId });

		expect(putTierSource).not.toHaveBeenCalled();
		expect(updateFetchTimestamp).not.toHaveBeenCalled();
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it("terminalises a content-too-large crawl in-process via markCrawlUnsupported, never deferring to the comprehensive crawl that would re-fetch and OOM on the same body", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const markCrawlStage = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "unsupported",
			reason: "content body too large: 54090542 bytes (cap 29360128 bytes)",
			unsupportedReason: { kind: "content-too-large", bytes: 54090542 },
		});

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle,
			transitionAndPersist,
			emitSimpleCrawlUnsupported,
			markCrawlStage,
		});

		await expect(saveLinkWork("https://example.com/huge", { saveAttemptId })).resolves.toBe("tier-1-terminal");
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlUnsupported, {
			url: "https://example.com/huge",
			input: { reason: { kind: "content-too-large", bytes: 54090542 } },
		});
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
		expect(markCrawlStage).not.toHaveBeenCalledWith({
			url: "https://example.com/huge",
			stage: "comprehensive-fetching",
		});
	});

	it("defers an unsupported crawl with no structured reason (non-html body) to the comprehensive crawl", async () => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const markCrawlStage = jest.fn().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "unsupported",
			reason: "unsupported content type: application/pdf",
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, emitSimpleCrawlUnsupported, markCrawlStage });

		await expect(saveLinkWork("https://example.com/doc.pdf", { saveAttemptId })).resolves.toEqual({ deferred: undefined });
		expect(markCrawlStage).toHaveBeenCalledWith({
			url: "https://example.com/doc.pdf",
			stage: "comprehensive-fetching",
		});
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalled();
	});

	it("carries a javascript-required deferral's reason into the emitted event and the result so the policy can route it to the render crawl", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "unsupported",
			reason: "javascript-required",
			unsupportedReason: { kind: "javascript-required" },
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, emitSimpleCrawlUnsupported });

		await expect(saveLinkWork("https://example-spa.test/post", { userId: UserIdSchema.parse("user-1"), saveAttemptId })).resolves.toEqual({ deferred: "javascript-required" });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: "https://example-spa.test/post",
			unsupportedReason: "javascript-required",
			userId: "user-1",
			saveAttemptId,
		});
	});

	it("returns the deferred reason without emitting when the archive pairing owns the emit", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle: CrawlAndFinalizeArticle = async () => ({
			status: "unsupported",
			reason: "paywall",
			unsupportedReason: { kind: "paywall" },
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, emitSimpleCrawlUnsupported });

		await expect(saveLinkWork("https://example-spa.test/post", { saveAttemptId, deferUnsupported: true })).resolves.toEqual({ deferred: "paywall" });
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it.each([402, 403, 429])("defers an edge-blocked link (HTTP %i) to the render ladder instead of settling it", async (httpStatus) => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const markCrawlStage = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const logCrawlOutcome = jest.fn();

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: blockedCrawl(httpStatus),
			emitSimpleCrawlUnsupported,
			markCrawlStage,
			transitionAndPersist,
			logCrawlOutcome,
		});

		await expect(saveLinkWork("https://example.com/walled", { saveAttemptId, userId: UserIdSchema.parse("u1"), recrawl: true })).resolves.toEqual({ deferred: "blocked" });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: "https://example.com/walled",
			unsupportedReason: "blocked",
			userId: "u1",
			recrawl: true,
			saveAttemptId,
		});
		expect(markCrawlStage).toHaveBeenCalledWith({ url: "https://example.com/walled", stage: "comprehensive-fetching" });
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(logCrawlOutcome).not.toHaveBeenCalled();
	});

	it("still adopts the blocked crawl's redirect terminal so the deferred render inherits the canonical identity", async () => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: blockedCrawl(403),
			adoptCanonicalIdentity,
			emitSimpleCrawlUnsupported: jest.fn().mockResolvedValue(undefined),
		});

		await saveLinkWork("https://example.com/walled", { saveAttemptId });

		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://example.com/walled",
			finalUrl: undefined,
			outcome: { kind: "crawl-failed" },
			recrawl: undefined,
		});
	});

	it("reports a blocked candidate without emitting the deferral when the caller defers unsupported pages itself", async () => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedCrawl(403), emitSimpleCrawlUnsupported });

		await expect(saveLinkWork("https://example.com/walled", { saveAttemptId, deferUnsupported: true })).resolves.toEqual({ deferred: "blocked" });
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it("writes no tier source for an edge-blocked link", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);

		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: blockedCrawl(403),
			putTierSource,
			emitSimpleCrawlUnsupported: jest.fn().mockResolvedValue(undefined),
		});

		await saveLinkWork("https://example.com/walled", { saveAttemptId });

		expect(putTierSource).not.toHaveBeenCalled();
	});

	it("defers a transport failure the proxy could reach past to the render ladder", async () => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const timedOutCrawl: CrawlAndFinalizeArticle = async () => ({
			status: "failed",
			reason: "crawl-failed",
			cause: Object.assign(new Error("timed out"), { name: "TimeoutError" }),
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: timedOutCrawl, emitSimpleCrawlUnsupported, transitionAndPersist });

		await expect(saveLinkWork("https://example.com/slow", { saveAttemptId })).resolves.toEqual({ deferred: "blocked" });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({ unsupportedReason: "blocked" }));
		expect(transitionAndPersist).not.toHaveBeenCalled();
	});

	it("defers a paired save's direct 403 as blocked with no tier source", async () => {
		const putTierSource: PutTierSource = jest.fn().mockResolvedValue(undefined);
		const finalizeArticle: FinalizeArticle = async () => {
			throw new Error("a block page must not reach finalize");
		};
		const crawlArticle = initCrawlArticle({
			crawlFetch: async () => new Response("<html><body>Access denied</body></html>", { status: 403, headers: { "content-type": "text/html" } }),
			siteRules: [],
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle }), putTierSource });

		await expect(saveLinkWork("https://example.com/walled", { saveAttemptId, deferUnsupported: true })).resolves.toEqual({ deferred: "blocked" });
		expect(putTierSource).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "a blocked address", cause: Object.assign(new Error("blocked address"), { code: "EBLOCKEDADDRESS" }) },
		{ label: "an abort", cause: Object.assign(new Error("aborted"), { name: "AbortError" }) },
		{ label: "a DNS failure", cause: Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }) },
		{ label: "a TLS failure", cause: Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }) },
	])("fails the crawl on $label with no deferral to the proxy", async ({ cause }) => {
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const hardFailure: CrawlAndFinalizeArticle = async () => ({ status: "failed", reason: "crawl-failed", cause });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: hardFailure, emitSimpleCrawlUnsupported, transitionAndPersist });

		await expect(saveLinkWork("https://example.com/hard", { saveAttemptId })).rejects.toThrow(ClassifiedCrawlError);
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlFailed, expect.objectContaining({ url: "https://example.com/hard" }));
		expect(emitSimpleCrawlUnsupported).not.toHaveBeenCalled();
	});

	it("hands the redirect terminal + word count to adoptCanonicalIdentity before binding a successful tier-1 candidate", async () => {
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

		const result = await saveLinkWork("https://site.com/page.html", { userId: UserIdSchema.parse("u1"), saveAttemptId });

		expect(result).toEqual({ candidate: { id: expect.any(String), tier: "tier-1" } });
		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://site.com/page.html",
			finalUrl: "https://site.com/page",
			outcome: { kind: "finalized", wordCount: 321 },
			recrawl: undefined,
		});
	});

	it.each<{ name: string; retained: { httpStatus: number; parseFailure?: string } }>([
		{ name: "an HTTP 403 body", retained: { httpStatus: 403 } },
		{ name: "an unparseable HTTP 200 body", retained: { httpStatus: 200, parseFailure: "no readable content" } },
	])("stores $name retained for a paired archive attempt as a candidate without recording a successful crawl", async ({ retained }) => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const updateFetchTimestamp = jest.fn().mockResolvedValue(undefined);
		const putTierSource = jest.fn().mockResolvedValue(undefined);
		const logCrawlOutcome = jest.fn();
		const retainedCrawl: CrawlAndFinalizeArticle = async () => ({
			status: "fetched",
			article: {
				html: "",
				metadata: { title: "", siteName: "", excerpt: "", wordCount: 0, estimatedReadTime: 0 },
			},
			evaluationHtml: "<html><body>Verify you are human</body></html>",
			finalUrl: "https://site.com/challenge",
			bodyHash: "c".repeat(64),
			...retained,
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: retainedCrawl, adoptCanonicalIdentity, updateFetchTimestamp, putTierSource, logCrawlOutcome });

		const result = await saveLinkWork("https://site.com/page", { saveAttemptId, deferUnsupported: true });

		expect(result).toEqual({ candidate: { id: expect.any(String), tier: "tier-1" } });
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ tier: "tier-1", evaluationHtml: "<html><body>Verify you are human</body></html>" }));
		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://site.com/page",
			finalUrl: "https://site.com/challenge",
			outcome: { kind: "crawl-failed" },
			recrawl: undefined,
		});
		expect(updateFetchTimestamp).toHaveBeenCalledTimes(0);
		expect(logCrawlOutcome).toHaveBeenCalledWith({
			url: "https://site.com/page",
			thisTier: "tier-1",
			thisTierStatus: "failed",
			otherTierStatus: "not_attempted",
			pickedTier: "none",
		});
	});

	it("claims the redirect destination on the retryable failure path, before the throw that dead-letters the message", async () => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const unreachableDestination: CrawlAndFinalizeArticle = async () => ({
			status: "failed",
			reason: "crawl-failed",
			finalUrl: "https://dest.example/article",
		});
		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: unreachableDestination,
			adoptCanonicalIdentity,
		});

		await expect(saveLinkWork("https://wrapper.example/link/188518", { saveAttemptId })).rejects.toThrow(
			"crawl failed for https://wrapper.example/link/188518: crawl-failed",
		);

		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://wrapper.example/link/188518",
			finalUrl: "https://dest.example/article",
			outcome: { kind: "crawl-failed" },
			recrawl: undefined,
		});
	});

	it("claims the redirect destination when an edge blocks the crawler at the destination", async () => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const challengedAtDestination: CrawlAndFinalizeArticle = async () => ({
			status: "blocked",
			httpStatus: 403,
			finalUrl: "https://dest.example/article",
		});
		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: challengedAtDestination,
			adoptCanonicalIdentity,
			emitSimpleCrawlUnsupported: jest.fn().mockResolvedValue(undefined),
		});

		await expect(saveLinkWork("https://wrapper.example/link/188518", { saveAttemptId })).resolves.toEqual({ deferred: "blocked", finalUrl: "https://dest.example/article" });

		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://wrapper.example/link/188518",
			finalUrl: "https://dest.example/article",
			outcome: { kind: "crawl-failed" },
			recrawl: undefined,
		});
	});

	it("claims the redirect destination on a parse-error failure too", async () => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const unparseableAtDestination: CrawlAndFinalizeArticle = async () => ({
			status: "failed",
			reason: "readability crashed",
			finalUrl: "https://dest.example/article",
		});
		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: unparseableAtDestination,
			adoptCanonicalIdentity,
		});

		await expect(saveLinkWork("https://wrapper.example/link/188519", { saveAttemptId })).rejects.toThrow(
			"crawl failed for https://wrapper.example/link/188519: readability crashed",
		);

		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://wrapper.example/link/188519",
			finalUrl: "https://dest.example/article",
			outcome: { kind: "crawl-failed" },
			recrawl: undefined,
		});
	});

	it("claims the redirect destination on a not-found, so a dead link is keyed where the chain actually landed", async () => {
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const goneAtDestination: CrawlAndFinalizeArticle = async () => ({
			status: "not-found",
			httpStatus: 404,
			finalUrl: "https://dest.example/gone",
		});
		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: goneAtDestination,
			adoptCanonicalIdentity,
		});

		await expect(saveLinkWork("https://wrapper.example/link/188481", { saveAttemptId })).resolves.toBe("tier-1-terminal");

		expect(adoptCanonicalIdentity).toHaveBeenCalledWith({
			url: "https://wrapper.example/link/188481",
			finalUrl: "https://dest.example/gone",
			outcome: { kind: "crawl-failed" },
			recrawl: undefined,
		});
	});
});

describe("initSaveLinkWork — a queued twitter.com identity", () => {
	it("fetches x.com but keeps writing under twitter.com, claiming no alias for the moved fetch", async () => {
		const fetched: string[] = [];
		const finalized: { url: string; documentUrl: string }[] = [];
		const crawlArticle: CrawlArticle = async (params) => {
			fetched.push(params.url);
			return { status: "fetched", html: "<p>just setting up my twttr</p>", bodyHash: "b".repeat(64), finalUrl: params.url };
		};
		const finalizeArticle: FinalizeArticle = async (input) => {
			finalized.push({ url: input.url, documentUrl: input.documentUrl });
			return {
				ok: true,
				article: {
					html: input.html,
					metadata: { title: "jack", siteName: "x.com", excerpt: "", wordCount: 5, estimatedReadTime: 1 },
				},
			};
		};
		const adoptDestination = jest.fn<ReturnType<AdoptArticleDestination>, Parameters<AdoptArticleDestination>>().mockResolvedValue("adopted");
		const putTierSource = jest.fn<ReturnType<PutTierSource>, Parameters<PutTierSource>>(async () => {});
		const { saveLinkWork } = createWork({
			crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({
				crawlArticle: initFetchPinnedCrawl({ crawlArticle, findAdoptedFetchUrl: async () => undefined }),
				finalizeArticle,
			}),
			putTierSource,
			adoptCanonicalIdentity: initAdoptCanonicalIdentity({
				adoptDestination,
				reconcileStubMetadata: async () => {},
				isSiteRuleUrl: () => false,
				now: fixedNow,
				logger: noopLogger,
			}),
		});

		await saveLinkWork("https://twitter.com/jack/status/20", { saveAttemptId });

		expect(fetched).toEqual(["https://x.com/jack/status/20"]);
		expect(finalized).toEqual([{ url: "https://twitter.com/jack/status/20", documentUrl: "https://x.com/jack/status/20" }]);
		expect(putTierSource).toHaveBeenCalledWith(expect.objectContaining({ url: "https://twitter.com/jack/status/20", tier: "tier-1" }));
		expect(adoptDestination.mock.calls).toEqual([]);
	});
});

describe("initSaveLinkWork — the tier-1 commit tail", () => {
	it.each<{ name: string; fetched: { httpStatus: number; evaluationHtml?: string; etag?: string }; status: "success" | "failed" }>([
		{ name: "a readable 200", fetched: { httpStatus: 200, etag: "\"v1\"" }, status: "success" },
		{ name: "a retained 403 with its evaluation bytes", fetched: { httpStatus: 403, evaluationHtml: "<html><body>Denied</body></html>" }, status: "failed" },
	])("stores $name, records freshness only for a success, and reports the outcome in that order", async ({ fetched, status }) => {
		const trace: unknown[][] = [];
		let tick = 0;
		const record = (name: string) => async (params: unknown) => {
			trace.push([name, params]);
		};
		const article = { html: "<p>body</p>", metadata: { title: "T", siteName: "S", excerpt: "E", wordCount: 321, estimatedReadTime: 2, imageUrl: "https://site.com/i.png" } };
		const { saveLinkWork } = createWork({
			resolveOriginalUrl: async (u) => {
				trace.push(["resolveOriginalUrl", u]);
				return "https://site.com/original";
			},
			crawlAndFinalizeArticle: async (params) => {
				trace.push(["crawlAndFinalizeArticle", params]);
				return { status: "fetched", article, finalUrl: "https://site.com/final", bodyHash: "b".repeat(64), lastModified: "Tue, 28 Oct 2026 00:00:00 GMT", ...fetched };
			},
			putTierSource: record("putTierSource"),
			updateFetchTimestamp: record("updateFetchTimestamp"),
			markCrawlStage: record("markCrawlStage"),
			adoptCanonicalIdentity: record("adoptCanonicalIdentity"),
			readTierSnapshot: async (params) => {
				trace.push(["readTierSnapshot", params]);
				return { tier0Status: "success", tier1Status: "not_attempted", pickedTier: "tier-0" };
			},
			logCrawlOutcome: (params) => {
				trace.push(["logCrawlOutcome", params]);
			},
			logger: { ...noopLogger, info: (message, context) => trace.push(["logger.info", message, context]) },
			now: () => {
				tick += 1;
				trace.push(["now"]);
				return new Date(Date.UTC(2026, 3, 18, 12, 0, tick));
			},
		});

		const result = await saveLinkWork("https://site.com/page", { saveAttemptId, recrawl: true });

		const metadata = candidateProvenance({
			metadata: article.metadata,
			html: article.html,
			evaluationHtml: fetched.evaluationHtml ?? article.html,
			attemptId: saveAttemptId,
			originalUrl: "https://site.com/original",
			sourceUrl: "https://site.com/final",
			kind: "live",
			fetchedAt: "2026-04-18T12:00:01.000Z",
			httpStatus: fetched.httpStatus,
		});
		expect(result).toEqual({ candidate: { id: metadata.id, tier: "tier-1" } });
		expect(trace).toEqual([
			["resolveOriginalUrl", "https://site.com/page"],
			["now"],
			["markCrawlStage", { url: "https://site.com/page", stage: "crawl-fetching" }],
			["crawlAndFinalizeArticle", { url: "https://site.com/original", writeContext: { url: "https://site.com/page", attemptId: saveAttemptId } }],
			["adoptCanonicalIdentity", { url: "https://site.com/page", finalUrl: "https://site.com/final", outcome: status === "success" ? { kind: "finalized", wordCount: 321 } : { kind: "crawl-failed" }, recrawl: true }],
			["resolveOriginalUrl", "https://site.com/page"],
			["putTierSource", { url: "https://site.com/page", tier: "tier-1", html: article.html, metadata, evaluationHtml: fetched.evaluationHtml }],
			["markCrawlStage", { url: "https://site.com/page", stage: "crawl-content-uploaded" }],
			...(status === "success"
				? [["now"], ["updateFetchTimestamp", { url: "https://site.com/page", contentFetchedAt: "2026-04-18T12:00:02.000Z", etag: "\"v1\"", lastModified: "Tue, 28 Oct 2026 00:00:00 GMT", bodyHash: "b".repeat(64) }]]
				: []),
			["readTierSnapshot", { url: "https://site.com/page" }],
			["logCrawlOutcome", { url: "https://site.com/page", thisTier: "tier-1", thisTierStatus: status, otherTierStatus: "success", pickedTier: "tier-0" }],
			["logger.info", "[save-link-work.test] tier-1 source written", { url: "https://site.com/page", imageUrl: "https://site.com/i.png" }],
		]);
	});
});

describe("initSaveLinkWork — the page the free crawl reached", () => {
	const TRACKER = "https://links.tracker.example/r/abc?mid=1";
	const PUBLISHER = "https://publisher.example/story";

	function respondingFrom(params: { url: string; status: number; body: string }): Response {
		const response = new Response(params.body, { status: params.status, headers: { "content-type": "text/html" } });
		Object.defineProperty(response, "url", { value: params.url });
		return response;
	}

	function realCrawl(crawlFetch: (url: string) => Promise<Response>, finalizeArticle: FinalizeArticle): CrawlAndFinalizeArticle {
		const crawlArticle = initCrawlArticle({
			crawlFetch: async (url) => crawlFetch(url),
			siteRules: [],
			logError: () => {},
			logInfo: () => {},
			logThumbnailNotDelivered: () => {},
		});
		return deferJavascriptShells({ crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle }) });
	}

	const unusedFinalize: FinalizeArticle = async () => {
		throw new Error("a block page must not reach finalize");
	};

	it("hands the render crawl the publisher a tracker redirected to when the publisher blocked the free crawl, so the paid legs skip the tracker", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const crawlAndFinalizeArticle = realCrawl(async () => respondingFrom({ url: PUBLISHER, status: 403, body: "<html><body>Access denied</body></html>" }), unusedFinalize);

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, emitSimpleCrawlUnsupported });

		await expect(saveLinkWork(TRACKER, { userId: UserIdSchema.parse("user-1"), saveAttemptId })).resolves.toEqual({ deferred: "blocked", finalUrl: PUBLISHER });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({
			url: TRACKER,
			unsupportedReason: "blocked",
			userId: "user-1",
			saveAttemptId,
			finalUrl: PUBLISHER,
		});
	});

	it("keeps the last redirect hop the free crawl reached before an ordinary timeout", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const timedOutAfterHop: CrawlAndFinalizeArticle = async () => ({
			status: "failed",
			reason: "crawl-failed",
			finalUrl: PUBLISHER,
			cause: Object.assign(new Error("timed out"), { name: "TimeoutError" }),
		});

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: timedOutAfterHop, emitSimpleCrawlUnsupported });

		await expect(saveLinkWork(TRACKER, { saveAttemptId })).resolves.toEqual({ deferred: "blocked", finalUrl: PUBLISHER });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({ finalUrl: PUBLISHER }));
	});

	it.each([
		{ label: "a response that did not redirect", finalUrl: TRACKER },
		{ label: "a response whose URL differs only in host case", finalUrl: "https://LINKS.tracker.example/r/abc?mid=1" },
		{ label: "a failure with no response", finalUrl: undefined },
	])("names no changed target for $label, so the render starts where it always did", async ({ finalUrl }) => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const blockedAt: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403, finalUrl });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedAt, emitSimpleCrawlUnsupported });

		await saveLinkWork(TRACKER, { saveAttemptId });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({ url: TRACKER, unsupportedReason: "blocked", saveAttemptId });
	});

	it("compares the terminal with the URL actually requested, the resolved original, not the stored row key", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const blockedAtOriginal: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403, finalUrl: PUBLISHER });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedAtOriginal, emitSimpleCrawlUnsupported, resolveOriginalUrl: async () => PUBLISHER });

		await saveLinkWork(TRACKER, { saveAttemptId });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({ url: TRACKER, unsupportedReason: "blocked", saveAttemptId });
	});

	it("keeps a same-host redirect, which is still a different page to start from", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const blockedAfterSameHostHop: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403, finalUrl: "https://links.tracker.example/landing" });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedAfterSameHostHop, emitSimpleCrawlUnsupported });

		await saveLinkWork(TRACKER, { saveAttemptId });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({ finalUrl: "https://links.tracker.example/landing" }));
	});

	it.each([
		{ label: "an SSO transit hop", finalUrl: "https://idp.example/transit?redirect_uri=https://publisher.example/story" },
		{ label: "a wrapper", finalUrl: "https://web.archive.org/web/20180630081250/https://publisher.example/story" },
	])("names no target when the free crawl ended on $label, so the paid legs never render the detour", async ({ finalUrl }) => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const blockedAtDetour: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403, finalUrl });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedAtDetour, emitSimpleCrawlUnsupported });

		await expect(saveLinkWork(TRACKER, { saveAttemptId })).resolves.toEqual({ deferred: "blocked" });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({ url: TRACKER, unsupportedReason: "blocked", saveAttemptId });
	});

	it("names no target when the free crawl ended on a site-rule URL, which keeps its bespoke crawl", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const unsupportedAtSiteRule: CrawlAndFinalizeArticle = async () => ({ status: "unsupported", reason: "non-html", unsupportedReason: { kind: "javascript-required" }, finalUrl: PUBLISHER });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: unsupportedAtSiteRule, emitSimpleCrawlUnsupported, isSiteRuleUrl: (url) => url === PUBLISHER });

		await expect(saveLinkWork(TRACKER, { saveAttemptId })).resolves.toEqual({ deferred: "javascript-required" });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({ url: TRACKER, unsupportedReason: "javascript-required", saveAttemptId });
	});

	it("leaves an admin recrawl on its pinned path with no observed target", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const blockedAtPublisher: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403, finalUrl: PUBLISHER });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedAtPublisher, emitSimpleCrawlUnsupported });

		await expect(saveLinkWork(TRACKER, { saveAttemptId, recrawl: true })).resolves.toEqual({ deferred: "blocked" });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({ url: TRACKER, unsupportedReason: "blocked", recrawl: true, saveAttemptId });
	});

	it("still settles a dead destination as not-found rather than paying to retry it", async () => {
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const goneAtPublisher: CrawlAndFinalizeArticle = async () => ({ status: "not-found", httpStatus: 404, finalUrl: PUBLISHER });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: goneAtPublisher, transitionAndPersist });

		await expect(saveLinkWork(TRACKER, { saveAttemptId })).resolves.toBe("tier-1-terminal");
		expect(transitionAndPersist).toHaveBeenCalledWith(markCrawlNotFound, { url: TRACKER, input: { reason: { kind: "not-found", httpStatus: 404 } } });
	});

	it("hands the render crawl the publisher of a redirected javascript shell without adopting the zero-word page as the article's identity", async () => {
		const emitSimpleCrawlUnsupported = jest.fn<ReturnType<EmitSimpleCrawlUnsupported>, Parameters<EmitSimpleCrawlUnsupported>>().mockResolvedValue(undefined);
		const adoptCanonicalIdentity = jest.fn().mockResolvedValue(undefined);
		const emptyShell: FinalizeArticle = async () => ({
			ok: true,
			article: { html: "<div></div>", metadata: { title: "App", siteName: "publisher.example", excerpt: "", wordCount: 0, estimatedReadTime: 0 } },
		});
		const crawlAndFinalizeArticle = realCrawl(
			async () => respondingFrom({ url: PUBLISHER, status: 200, body: '<html><head><title>App</title><script src="/app.js"></script></head><body><div id="root"></div></body></html>' }),
			emptyShell,
		);

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle, emitSimpleCrawlUnsupported, adoptCanonicalIdentity });

		await expect(saveLinkWork(TRACKER, { saveAttemptId })).resolves.toEqual({ deferred: "javascript-required", finalUrl: PUBLISHER });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith({ url: TRACKER, unsupportedReason: "javascript-required", saveAttemptId, finalUrl: PUBLISHER });
		expect(adoptCanonicalIdentity).toHaveBeenCalledTimes(0);
	});

	it("returns the observed target to a paired save that emits the deferral itself", async () => {
		const blockedAtPublisher: CrawlAndFinalizeArticle = async () => ({ status: "blocked", httpStatus: 403, finalUrl: PUBLISHER });

		const { saveLinkWork } = createWork({ crawlAndFinalizeArticle: blockedAtPublisher });

		await expect(saveLinkWork(TRACKER, { saveAttemptId, deferUnsupported: true })).resolves.toEqual({ deferred: "blocked", finalUrl: PUBLISHER });
	});
});
