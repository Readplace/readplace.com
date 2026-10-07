import { SaveAttemptIdSchema, CandidateIdSchema } from "@packages/domain/article";
import { initCrawlSaveCandidates } from "./crawl-save-candidates";
import { ClassifiedCrawlError, initSaveLinkWork } from "./save-link-work";
import { initCrawlArchiveCapture } from "./crawl-archive-capture";
import { initCrawlArticle } from "@packages/crawl-article";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import { noopLogger } from "@packages/hutch-logger";
import type { PutTierSource } from "../../providers/article-store/put-tier-source";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { initSelectMostCompleteContent } from "../select-content/select-content";
import { initLogContentSelection, initPrepareContentSelection } from "../select-content/prepare-content-selection";
import type { TierSource } from "../select-content/tier-source.types";

const cid = (id: string) => CandidateIdSchema.parse(id);

const url = "https://example.com/article";
const captureUrl = `https://web.archive.org/web/20081203/${url}`;
const params = { url, captureUrl, saveAttemptId: SaveAttemptIdSchema.parse("save-attempt") };
const wrapper = { id: cid("archive"), tier: "tier-2" as const };
const live = { candidate: { id: cid("live"), tier: "tier-1" as const } };

describe("archive attempt orchestration", () => {
	it("judges the complete HTTP 403 live response against the archive and keeps the readable losing archive in its audit", async () => {
		const article = `<p>${"A real article contains important facts and readable paragraphs. ".repeat(30)}</p>`;
		const wrapperBody = `<html><head><title>Archived report</title></head><body><article>${article}</article></body></html>`;
		const liveBody = `<html><head><title>Full report</title></head><body><nav>Fresh raw response navigation</nav><article>${article}<p>${"The original has an additional detailed section missing from the archive. ".repeat(20)}</p></article></body></html>`;
		const crawlArticle = initCrawlArticle({ crawlFetch: async (target) => new Response(target === url ? liveBody : wrapperBody, { status: target === url ? 403 : 200, headers: { "content-type": "text/html" } }), siteRules: [], logError: () => {}, logInfo: () => {} });
		const { parseHtml } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: () => {} });
		const finalizeArticle = initFinalizeArticle({ parseHtml, downloadMedia: async () => [], processContent: async ({ html }) => html, fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }), putImageObject: async () => {}, imagesCdnBaseUrl: "https://cdn.example.com" });
		const stored: TierSource[] = [];
		const now = () => new Date("2026-10-05T00:00:00.000Z");
		const shared = {
			crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle }),
			putTierSource: async (source: Parameters<PutTierSource>[0]) => { stored.push(source); },
			readTierSnapshot: async () => ({ tier0Status: "not_attempted" as const, tier1Status: "not_attempted" as const, pickedTier: "none" as const }),
			logCrawlOutcome: () => {}, logger: noopLogger, now,
		};
		const transitionAndPersist = jest.fn().mockResolvedValue(undefined);
		const emitSimpleCrawlUnsupported = jest.fn().mockResolvedValue(undefined);
		const { saveLinkWork } = initSaveLinkWork({ ...shared, emitSimpleCrawlUnsupported, resolveOriginalUrl: async () => url, updateFetchTimestamp: async () => {}, transitionAndPersist, markCrawlStage: async () => {}, adoptCanonicalIdentity: async () => {}, logParseError: () => {}, logPrefix: "test" });
		const verifyWrapperSource = async () => ({ originalUrl: url, sourceUrl: captureUrl });
		const crawlArchiveCapture = initCrawlArchiveCapture({ ...shared, verifyWrapperSource, publishEvent: async () => {} });
		const attempt = await initCrawlSaveCandidates({ saveLinkWork, crawlArchiveCapture, emitSimpleCrawlUnsupported })(params);
		expect(attempt.liveAttempt).toEqual({ outcome: "body" });
		expect(attempt.candidates).toHaveLength(2);
		expect(transitionAndPersist).not.toHaveBeenCalled();
		const liveSource = stored.find((source) => source.metadata.kind === "live");
		assert(liveSource);
		expect(liveSource.evaluationHtml).toBe(liveBody);
		expect(liveSource.metadata.contentHash).toBe(createHash("sha256").update(liveBody).digest("hex"));
		expect(liveSource.metadata.httpStatus).toBe(403);
		expect(liveSource.html).toContain("The original has an additional detailed section missing from the archive.");
		const createChatCompletion = jest.fn(async () => ({ choices: [{ message: { content: JSON.stringify({ kind: "winner", candidateId: liveSource.metadata.id, reason: "Live includes the additional article section", readability: stored.map((source) => ({ candidateId: source.metadata.id, readable: true })) }) } }] }));
		const selection = await initPrepareContentSelection({
			readCanonicalContent: async () => undefined,
			loadArticle: async () => ({ url, metadata: liveSource.metadata, freshness: { contentFetchedAt: now().toISOString() }, estimatedReadTime: 1, crawl: { kind: "ready" }, summary: { kind: "ready", summary: "Existing summary" }, summaryAutoHeal: { attempts: 0 } }),
			listAvailableTierSources: async () => stored, resolveOriginalUrl: async () => url, verifyWrapperSource,
			...initSelectMostCompleteContent({ createChatCompletion, logger: noopLogger }),
		})({ url, candidates: attempt.candidates });
		expect(selection.selected?.metadata.kind).toBe("live");
		const info = jest.fn();
		initLogContentSelection({ logger: { ...noopLogger, info } })({ saveAttemptId: params.saveAttemptId, selection, liveAttempt: attempt.liveAttempt });
		expect(info).toHaveBeenCalledWith(expect.stringContaining('"kind":"wrapper"'));
		const logged = JSON.parse(String(info.mock.calls[0]?.[0]).split("comparison completed ")[1]);
		expect(logged.candidates.find((candidate: { kind: string }) => candidate.kind === "wrapper")).toMatchObject({ readable: true, fresh: true });
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
		const save = initCrawlSaveCandidates({ crawlArchiveCapture: async () => wrapper, saveLinkWork: async () => "tier-1-deferred", emitSimpleCrawlUnsupported: emit });
		expect(await save(params)).toEqual({ candidates: [wrapper], liveAttempt: { outcome: "deferred" } });
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ url, saveAttemptId: params.saveAttemptId, candidates: [wrapper] }));
	});
	it("records an empty live response as a live failure while the extracted archive still reaches selection", async () => {
		const crawlArticle = initCrawlArticle({ crawlFetch: async (target) => new Response(target === url ? "" : `<html><head><title>Archived report</title></head><body><article><p>${"A real article contains important facts and readable paragraphs. ".repeat(30)}</p></article></body></html>`, { status: 200, headers: { "content-type": "text/html" } }), siteRules: [], logError: () => {}, logInfo: () => {} });
		const { parseHtml } = initReadabilityParser({ crawlArticle, siteRules: [], readabilityAdditions, logError: () => {} });
		const finalizeArticle = initFinalizeArticle({ parseHtml, downloadMedia: async () => [], processContent: async ({ html }) => html, fetchThumbnailImage: async () => ({ image: undefined, provenUnusable: [] }), putImageObject: async () => {}, imagesCdnBaseUrl: "https://cdn.example.com" });
		const crawlAndFinalizeArticle = initCrawlAndFinalizeArticle({ crawlArticle, finalizeArticle });
		const putTierSource = jest.fn<ReturnType<PutTierSource>, Parameters<PutTierSource>>(async () => {});
		const readTierSnapshot = async () => ({ tier0Status: "not_attempted" as const, tier1Status: "failed" as const, pickedTier: "none" as const });
		const emitSimpleCrawlUnsupported = async () => {};
		const shared = { crawlAndFinalizeArticle, putTierSource, readTierSnapshot, logCrawlOutcome: () => {}, logger: noopLogger, now: () => new Date("2026-10-01T00:00:00Z") };
		const { saveLinkWork } = initSaveLinkWork({ ...shared, emitSimpleCrawlUnsupported, resolveOriginalUrl: async (input) => input, updateFetchTimestamp: async () => {}, transitionAndPersist: async () => {}, markCrawlStage: async () => {}, adoptCanonicalIdentity: async () => {}, logParseError: () => {}, logPrefix: "test" });
		const crawlArchiveCapture = initCrawlArchiveCapture({ ...shared, verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }), publishEvent: async () => {} });
		const result = await initCrawlSaveCandidates({ saveLinkWork, crawlArchiveCapture, emitSimpleCrawlUnsupported })(params);
		expect(result).toEqual({ candidates: [{ id: expect.any(String), tier: "tier-2" }], liveAttempt: { outcome: "no-body", failureReason: { kind: "parse-error", detail: "no <html> element in response body" } } });
		expect(putTierSource.mock.calls.map(([source]) => source.tier)).toEqual(["tier-2"]);
		expect(putTierSource.mock.calls[0]?.[0].html).toContain("important facts");
	});
});
