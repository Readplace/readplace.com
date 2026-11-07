import { UserIdSchema } from "@packages/domain/user";
import { SaveAttemptIdSchema, CandidateIdSchema } from "@packages/domain/article";
import { initCrawlSaveCandidates } from "./crawl-save-candidates";
import { ClassifiedCrawlError, initSaveLinkWork } from "./save-link-work";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";
import { initCrawlArticle } from "@packages/crawl-article";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import { noopLogger } from "@packages/logger";
import type { PutTierSource, TierSource } from "@packages/tier-source";

const cid = (id: string) => CandidateIdSchema.parse(id);

const url = "https://example.com/article";
const captureUrl = `https://web.archive.org/web/20081203/${url}`;
const params = { url, captureUrl, saveAttemptId: SaveAttemptIdSchema.parse("save-attempt") };
const wrapper = { id: cid("archive"), tier: "tier-2" as const };
const live = { candidate: { id: cid("live"), tier: "tier-1" as const } };

describe("archive attempt orchestration", () => {
	it("defers a live 403 to the render ladder with the archive as the candidate it carries", async () => {
		const article = `<p>${"A real article contains important facts and readable paragraphs. ".repeat(30)}</p>`;
		const wrapperBody = `<html><head><title>Archived report</title></head><body><article>${article}</article></body></html>`;
		const liveBody = `<html><head><title>Full report</title></head><body><nav>Fresh raw response navigation</nav><article>${article}<p>${"The original has an additional detailed section missing from the archive. ".repeat(20)}</p></article></body></html>`;
		const crawlArticle = initCrawlArticle({ crawlFetch: async (target) => new Response(target === url ? liveBody : wrapperBody, { status: target === url ? 403 : 200, headers: { "content-type": "text/html" } }), siteRules: [], logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });
		const { parseHtml } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: () => {} });
		const finalizeArticle = initFinalizeArticle({ parseHtml, downloadMedia: async () => [], processContent: async ({ html }) => html, fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }), putImageObject: async () => {}, imagesCdnBaseUrl: "https://cdn.example.com" });
		const stored: TierSource[] = [];
		const now = () => new Date("2026-10-05T00:00:00.000Z");
		const shared = {
			crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle }),
			putTierSource: async (source: Parameters<PutTierSource>[0]) => { stored.push(source); return source.metadata; },
			readTierSnapshot: async () => ({ tier0Status: "not_attempted" as const, tier1Status: "not_attempted" as const, pickedTier: "none" as const }),
			logCrawlOutcome: () => {}, logger: noopLogger, now,
		};
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const { saveLinkWork } = initSaveLinkWork({ ...shared, emitSimpleCrawlUnsupported, publishEvent: async () => {}, resolveOriginalUrl: async () => url, updateFetchTimestamp: async () => {}, transitionAndPersist, markCrawlStage: async () => {}, adoptCanonicalIdentity: async () => {}, isSiteRuleUrl: () => false, logParseError: () => {}, logPrefix: "test" });
		const verifyWrapperSource = async () => ({ originalUrl: url, sourceUrl: captureUrl });
		const crawlArchiveCapture = initCrawlArchiveCapture({ ...shared, verifyWrapperSource, publishEvent: async () => {} });
		const attempt = await initCrawlSaveCandidates({ saveLinkWork, crawlArchiveCapture, emitSimpleCrawlUnsupported })(params);
		expect(attempt).toEqual({ deferredTo: "simple-crawl-unsupported", carriedCandidates: 1 });
		expect(emitSimpleCrawlUnsupported).toHaveBeenCalledWith(expect.objectContaining({ unsupportedReason: "blocked", candidates: [{ id: expect.any(String), tier: "tier-2" }] }));
		expect(transitionAndPersist).not.toHaveBeenCalled();
		expect(stored.map((source) => source.metadata.kind)).toEqual(["wrapper"]);
	});
	it.each([true, false])("waits for both arrivals with wrapper first=%s", async (wrapperFirst) => {
		let finishLive: (() => void) | undefined;
		let finishWrapper: (() => void) | undefined;
		const save = initCrawlSaveCandidates({
			saveLinkWork: async () => { await new Promise<void>((resolve) => { finishLive = resolve; }); return live; },
			crawlArchiveCapture: async () => { await new Promise<void>((resolve) => { finishWrapper = resolve; }); return wrapper; },
			emitSimpleCrawlUnsupported: async () => {},
		});
		let settled = false;
		const pending = save(params).then((result) => { settled = true; return result; });
		if (wrapperFirst) finishWrapper?.(); else finishLive?.();
		await Promise.resolve();
		expect(settled).toBe(false);
		if (wrapperFirst) finishLive?.(); else finishWrapper?.();
		expect(await pending).toEqual({ candidates: [live.candidate, wrapper], liveAttempt: { outcome: "body" } });
	});
	it("keeps archive selection eligible when live returns classified parse failure", async () => {
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => wrapper, saveLinkWork: async () => { throw new ClassifiedCrawlError({ url, message: "empty live body", crawlFailureReason: { kind: "parse-error", detail: "empty" } }); }, emitSimpleCrawlUnsupported: async () => {} });
		expect(await save(params)).toEqual({ candidates: [wrapper], liveAttempt: { outcome: "no-body", failureReason: { kind: "parse-error", detail: "empty" } } });
	});
	it.each(["storage", "wrapper-storage"])("retries unexpected %s errors", async (location) => {
		const failure = new Error(location);
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => { if (location === "wrapper-storage") throw failure; return wrapper; }, saveLinkWork: async () => { if (location === "storage") throw failure; return live; }, emitSimpleCrawlUnsupported: async () => {} });
		await expect(save(params)).rejects.toThrow(failure);
	});
	it("reports terminal no-body without inventing candidates", async () => {
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => undefined, saveLinkWork: async () => "tier-1-terminal", emitSimpleCrawlUnsupported: async () => {} });
		expect(await save(params)).toEqual({ candidates: [], liveAttempt: { outcome: "no-body" } });
	});
	it("dispatches deferred live work with immutable wrapper references after capture finishes", async () => {
		const emit = jest.fn().mockResolvedValue(undefined);
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => wrapper, saveLinkWork: async () => ({ deferred: "javascript-required" }), emitSimpleCrawlUnsupported: emit });
		expect(await save(params)).toEqual({ deferredTo: "simple-crawl-unsupported", carriedCandidates: 1 });
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ url, unsupportedReason: "javascript-required", saveAttemptId: params.saveAttemptId, candidates: [wrapper] }));
	});
	it("dispatches deferred live work with no candidates when the capture yields no wrapper", async () => {
		const emit = jest.fn().mockResolvedValue(undefined);
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => undefined, saveLinkWork: async () => ({ deferred: "blocked" }), emitSimpleCrawlUnsupported: emit });
		expect(await save(params)).toEqual({ deferredTo: "simple-crawl-unsupported", carriedCandidates: 0 });
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ url, unsupportedReason: "blocked", candidates: [] }));
	});
	it("keeps the page the live crawl reached on the deferral it emits once the archive capture finishes", async () => {
		const emit = jest.fn().mockResolvedValue(undefined);
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => wrapper, saveLinkWork: async () => ({ deferred: "blocked", finalUrl: "https://publisher.example/story" }), emitSimpleCrawlUnsupported: emit });
		await save({ ...params, userId: UserIdSchema.parse("user-1") });
		expect(emit).toHaveBeenCalledWith({ url, unsupportedReason: "blocked", userId: "user-1", saveAttemptId: params.saveAttemptId, candidates: [wrapper], finalUrl: "https://publisher.example/story" });
	});
	it("records an empty live response as a live failure while the extracted archive still reaches selection", async () => {
		const crawlArticle = initCrawlArticle({ crawlFetch: async (target) => new Response(target === url ? "" : `<html><head><title>Archived report</title></head><body><article><p>${"A real article contains important facts and readable paragraphs. ".repeat(30)}</p></article></body></html>`, { status: 200, headers: { "content-type": "text/html" } }), siteRules: [], logError: () => {}, logInfo: () => {}, logThumbnailNotDelivered: () => {} });
		const { parseHtml } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: () => {} });
		const finalizeArticle = initFinalizeArticle({ parseHtml, downloadMedia: async () => [], processContent: async ({ html }) => html, fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }), putImageObject: async () => {}, imagesCdnBaseUrl: "https://cdn.example.com" });
		const crawlAndFinalizeArticle = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle });
		const putTierSource = jest.fn<ReturnType<PutTierSource>, Parameters<PutTierSource>>(async (params) => params.metadata);
		const readTierSnapshot = async () => ({ tier0Status: "not_attempted" as const, tier1Status: "failed" as const, pickedTier: "none" as const });
		const emitSimpleCrawlUnsupported = async () => {};
		const shared = { crawlAndFinalizeArticle, putTierSource, readTierSnapshot, logCrawlOutcome: () => {}, logger: noopLogger, now: () => new Date("2026-10-01T00:00:00Z") };
		const { saveLinkWork } = initSaveLinkWork({ ...shared, emitSimpleCrawlUnsupported, publishEvent: async () => {}, resolveOriginalUrl: async (input) => input, updateFetchTimestamp: async () => {}, transitionAndPersist: async () => {}, markCrawlStage: async () => {}, adoptCanonicalIdentity: async () => {}, isSiteRuleUrl: () => false, logParseError: () => {}, logPrefix: "test" });
		const crawlArchiveCapture = initCrawlArchiveCapture({ ...shared, verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }), publishEvent: async () => {} });
		const result = await initCrawlSaveCandidates({ saveLinkWork, crawlArchiveCapture, emitSimpleCrawlUnsupported })(params);
		expect(result).toEqual({ candidates: [{ id: expect.any(String), tier: "tier-2" }], liveAttempt: { outcome: "no-body", failureReason: { kind: "parse-error", detail: "no <html> element in response body" } } });
		expect(putTierSource.mock.calls.map(([source]) => source.tier)).toEqual(["tier-2"]);
		expect(putTierSource.mock.calls[0]?.[0].html).toContain("important facts");
	});
});
