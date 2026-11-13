import assert from "node:assert/strict";
import { initCrawlArticle, initCrawlFetch, rejectDocumentLandingPage, DEFAULT_CRAWL_HEADERS, type ExtractPdf } from "@packages/crawl-article";
import { initReadabilityParser, readabilityAdditions } from "@packages/article-parser";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import { initPrepareArticleIdentity } from "@packages/save-article";
import { initTransitionAndPersist, type Article, type TransitionAndPersist, recrawlPromoteTier } from "@packages/domain/article-aggregate";
import { noopLogger } from "@packages/logger";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { initRecordingPublishEvent } from "@packages/test-fixtures/providers/events";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { RecrawlContentExtractedEvent, TierContentExtractedEvent, SimpleCrawlUnsupportedEvent, ComprehensiveCrawlCommand } from "@packages/infra-components";
import type { PutTierSource, TierSource } from "@packages/tier-source";
import { initRecrawlLinkInitiatedHandler } from "./recrawl-link-initiated-handler";
import { initRunCrawlFromTier1 } from "./run-crawl-from-tier1";
import { initAdoptCanonicalIdentity } from "./adopt-canonical-identity";
import { initResolveArticleOnViewHandler } from "../resolve-on-view/resolve-article-on-view-handler";
import { initSimpleCrawlUnsupportedPolicyHandler } from "../simple-crawl-unsupported-policy/simple-crawl-unsupported-policy-handler";
import { initComprehensiveCrawlHandler } from "../comprehensive-crawl/comprehensive-crawl-handler";
import { initRecrawlContentExtractedHandler } from "../select-content/recrawl-content-extracted-handler";
import { initSelectMostCompleteContentHandler } from "../select-content/select-most-complete-content-handler";
import { initListAvailableTierSources } from "../select-content/list-available-tier-sources";
import { initRunMeteredLeg } from "../metered-leg/run-metered-leg";
import { initEmitSimpleCrawlUnsupported } from "../../dep-bundles/events";
import { initWriteCanonicalContent } from "../../providers/article-store/promote-tier-to-canonical";
import { computeCanonicalContentHash } from "../generate-summary/compute-canonical-content-hash";

const SOURCE = "https://link.camper.com/u/nrd.php?d=synthetic-public-notice";
const FAQ = "https://www.camper.com/int/at_cliente_faq?faq=97";
const PDF = "https://www.camper.com/html/legal/pdfs/privacy/general_privacy_policy_EN.pdf";
const NOW = new Date("2026-11-14T01:00:00.000Z");
const ARTICLE = `<html><head><title>Synthetic public policy</title></head><body><article><h1>Synthetic public policy</h1><p>${"The public policy explains synthetic conditions and qualifications for this test source. ".repeat(30)}</p></article></body></html>`;
function notice(url: string) {
	const escaped = url.replaceAll("&", "&amp;");
	return `<html><head><style type="text/css">body { color: #555; font-family: Arial, Verdana, Helvetica, sans-serif; font-weight: normal; font-size: 11px; } a { color: #555; }</style><meta http-equiv="content-type" content="text/html"><meta http-equiv="refresh" content="0; url=${escaped}"></head><body>If you are not redirected, please click <a href="${escaped}" id="redir">here</a></body></html>`;
}
const event = (detail: unknown) => buildSqsEvent([{ messageId: "synthetic-message", body: JSON.stringify({ detail }) }]);
const context = () => ({ ...buildLambdaContext(), getRemainingTimeInMillis: () => 900_000 });

function setup(target: string) {
	const store = initInMemoryArticleStore();
	const seed: Article = { url: SOURCE, metadata: { title: "Notice", siteName: "example.test", excerpt: "", wordCount: 8 }, estimatedReadTime: 1, freshness: { contentFetchedAt: NOW.toISOString() }, crawl: { kind: "pending", pendingSince: NOW.toISOString() }, summary: { kind: "pending", pendingSince: NOW.toISOString() }, summaryAutoHeal: { attempts: 0 } };
	store.seed(seed);
	let pinned: string | undefined;
	let mutableTarget = target;
	const requested: string[] = [];
	const fetchOrigin: typeof fetch = async input => {
		const url = String(input); requested.push(url);
		if (url === SOURCE) return new Response(notice(`${mutableTarget + (mutableTarget.includes("?") ? "&" : "?")}utm_source=synthetic`), { headers: { "content-type": "text/html" } });
		assert.equal(url, target);
		return url === PDF ? new Response("%PDF-1.4\nsynthetic", { headers: { "content-type": "application/pdf" } }) : new Response(ARTICLE, { headers: { "content-type": "text/html" } });
	};
	const crawlFetch = initCrawlFetch({ fetch: fetchOrigin, personas: [{ name: "synthetic", headers: { ...DEFAULT_CRAWL_HEADERS } }], isBlocked: () => false, logInfo: () => {}, egress: { kind: "direct" }, fetchCurl: async () => { throw new Error("unexpected curl fallback"); }, fetchH2: async () => { throw new Error("unexpected h2 fallback"); } });
	const makeCrawl = (extractPdf?: ExtractPdf) => initCrawlArticle({ crawlFetch, extractPdf, rejectDocumentLandingPage, siteRules: [], logInfo: () => {}, logError: () => {}, logThumbnailNotDelivered: () => {} });
	const cheap = makeCrawl();
	const { parseHtml } = initReadabilityParser({ crawlArticle: cheap, siteRules: [], readabilityAdditions, logError: () => {} });
	const finalizeArticle = initFinalizeArticle({ parseHtml, downloadMedia: async () => [], processContent: async ({ html }) => html, fetchThumbnailImage: async ({ candidates }) => ({ image: undefined, fetched: candidates, provenUnusable: [] }), putImageObject: async () => {}, imagesCdnBaseUrl: "https://images.example.test" });
	const prepareArticleIdentity = initPrepareArticleIdentity({ findIdentityRow: async () => ({ kind: "article", originalUrl: pinned ?? SOURCE }), resolveWrapperTarget: async () => undefined, repairWrapperIdentity: async () => false });
	const resolveOriginalUrl = async () => { const identity = await prepareArticleIdentity(SOURCE); assert(identity.status === "resolved"); return identity.originalUrl; };
	const adoptDestination = jest.fn(async ({ destinationUrl }: { articleUrl: string; destinationUrl: string; now: Date }) => { if (pinned !== undefined) return "declined" as const; pinned = destinationUrl; return "adopted" as const; });
	const adoptCanonicalIdentity = initAdoptCanonicalIdentity({ adoptDestination, reconcileStubMetadata: async () => {}, isSiteRuleUrl: () => false, now: () => NOW, logger: noopLogger });
	const { publishEvent, published } = initRecordingPublishEvent();
	const sources = new Map<string, TierSource>();
	const putTierSource: PutTierSource = async params => {
		const metadata = { ...params.metadata, htmlLocation: `candidates/${params.metadata.id}.html`, evaluationLocation: `candidates/${params.metadata.id}.evaluation.html` };
		sources.set(metadata.id, { tier: params.tier, html: params.html, evaluationHtml: params.evaluationHtml, metadata });
		return metadata;
	};
	const effects = jest.fn().mockResolvedValue(undefined);
	const aggregate = initTransitionAndPersist({ store, dispatchEffect: effects, logCrawlSettled: () => {} });
	const transitions = jest.fn();
	const transitionAndPersist: TransitionAndPersist = async (transition, params) => { transitions(transition, params); return aggregate.transitionAndPersist(transition, params); };
	const shared = { prepareArticleIdentity, resolveOriginalUrl, verifyWrapperSource: async () => undefined, crawlAndFinalizeArticle: initCrawlAndFinalizeArticle({ crawlArticle: cheap, finalizeArticle }), emitSimpleCrawlUnsupported: initEmitSimpleCrawlUnsupported({ publishEvent }), putTierSource, updateFetchTimestamp: async () => {}, transitionAndPersist, markCrawlStage: async () => {}, adoptCanonicalIdentity, isSiteRuleUrl: () => false, publishEvent, now: () => NOW, logger: noopLogger, logParseError: () => {}, logCrawlOutcome: () => {}, readTierSnapshot: async () => ({ tier0Status: "not_attempted" as const, tier1Status: "not_attempted" as const, pickedTier: "none" as const }), findContentSourceUrl: async () => undefined };
	const recrawl = initRecrawlLinkInitiatedHandler(shared);
	const onView = initResolveArticleOnViewHandler({ loadArticle: store.load, transitionAndPersist, runCrawlFromTier1: initRunCrawlFromTier1({ ...shared, logPrefix: "[synthetic]" }), publishEvent, now: () => NOW, logger: noopLogger });
	const runMeteredLeg = initRunMeteredLeg({ ...initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: () => false, now: () => NOW }), now: () => NOW, logger: noopLogger });
	const selectorDeps = { ...initListAvailableTierSources({ readTierSource: async ({ candidateId }) => candidateId === undefined ? undefined : sources.get(candidateId) }), loadArticle: store.load, transitionAndPersist, resolveOriginalUrl, verifyWrapperSource: shared.verifyWrapperSource, runMeteredLeg, selectMostCompleteContent: async () => { throw new Error("a lone substantial public body needs no judge"); }, writeCanonicalContent: initWriteCanonicalContent({ bucketName: "synthetic-content", s3Client: { send: async () => { throw new Error("persisted candidate must not be rewritten"); } } }).writeCanonicalContent, readCanonicalContent: async () => undefined, recordCrawlVersion: async () => {}, fetchYouTubeVideoCard: async () => undefined, fetchRedditPostCard: async () => undefined, putTierSource, now: () => NOW, logger: noopLogger, deepseekCallFailedLog: noopLogger };
	return { shared, recrawl, onView, selectorDeps, store, sources, published, requested, adoptDestination, transitions, effects, finalizeArticle, makeCrawl, runMeteredLeg, changeNotice: (next: string) => { mutableTarget = next; } };
}

describe("public publisher notices through actual save and recrawl ingress", () => {
	it.each(["recrawl", "resolve-on-view"] as const)("commits a public answer through %s and preserves source/canonical provenance", async ingress => {
		const test = setup(FAQ);
		const detail = { url: SOURCE, saveAttemptId: "synthetic-current-attempt" };
		const response = ingress === "recrawl" ? await test.recrawl(event(detail), context(), () => {}) : await test.onView(event({ ...detail, axes: "crawl-and-summary", surface: "reader" }), context(), () => {});
		expect(response).toEqual({ batchItemFailures: [] });
		const type = ingress === "recrawl" ? RecrawlContentExtractedEvent.detailType : TierContentExtractedEvent.detailType;
		const emitted = test.published.find(record => record.detailType === type); assert(emitted);
		const select = ingress === "recrawl" ? initRecrawlContentExtractedHandler(test.selectorDeps) : initSelectMostCompleteContentHandler(test.selectorDeps);
		expect(await select(event(emitted.detail), context(), () => {})).toEqual({ batchItemFailures: [] });
		const row = await test.store.load(SOURCE); assert(row);
		const selected = test.sources.get(row.contentSelection?.candidateId ?? ""); assert(selected);
		expect(test.requested).toEqual([SOURCE, FAQ]);
		expect(selected.metadata).toMatchObject({ originalUrl: ingress === "recrawl" ? SOURCE : FAQ, sourceUrl: FAQ, attemptId: detail.saveAttemptId, kind: "live" });
		expect(row.crawl).toEqual({ kind: "ready" });
		expect(row.freshness.canonicalContentHash).toBe(computeCanonicalContentHash(selected.html));
		expect(row.contentSelection?.contentLocation).toBe(`s3://synthetic-content/${selected.metadata.htmlLocation}`);
		expect(row.metadata.wordCount).toBeGreaterThan(100);
		expect(test.effects.mock.calls.map(([effect]) => effect)).toContainEqual({ kind: "publish-canonical-content-changed", url: SOURCE });
		if (ingress === "recrawl") {
			expect(test.adoptDestination).toHaveBeenCalledTimes(0);
			expect(test.transitions).toHaveBeenCalledWith(recrawlPromoteTier, expect.objectContaining({ url: SOURCE }));
		} else {
			expect(test.adoptDestination).toHaveBeenCalledWith({ articleUrl: SOURCE, destinationUrl: FAQ, now: NOW });
			test.changeNotice("https://account.example.test/mutable-action");
			expect(await test.recrawl(event({ ...detail, saveAttemptId: "synthetic-later-attempt" }), context(), () => {})).toEqual({ batchItemFailures: [] });
			expect(test.requested).toEqual([SOURCE, FAQ, FAQ]);
			expect(test.adoptDestination).toHaveBeenCalledTimes(1);
		}
	});

	it("defers the public PDF through the real policy and comprehensive worker before recrawl selection", async () => {
		const test = setup(PDF);
		await test.recrawl(event({ url: SOURCE, saveAttemptId: "synthetic-pdf-attempt" }), context(), () => {});
		const unsupported = test.published.find(record => record.detailType === SimpleCrawlUnsupportedEvent.detailType); assert(unsupported);
		expect(test.published.filter(record => record.detailType === RecrawlContentExtractedEvent.detailType)).toEqual([]);
		await initSimpleCrawlUnsupportedPolicyHandler({ publishEvent: test.shared.publishEvent, logger: noopLogger })(event(unsupported.detail), context(), () => {});
		const command = test.published.find(record => record.detailType === ComprehensiveCrawlCommand.detailType); assert(command);
		const extractPdf: ExtractPdf = jest.fn(async () => ({ kind: "fetched" as const, html: ARTICLE, title: "Synthetic privacy" }));
		const crawl = test.makeCrawl(extractPdf);
		const comprehensive = initComprehensiveCrawlHandler({ ...test.shared, crawlArticleWithPermit: ({ permit: _permit, ...params }) => crawl(params), runMeteredLeg: test.runMeteredLeg, finalizeArticle: test.finalizeArticle, markCrawlProgress: async () => {}, consumePaidCrawlBudget: async () => ({ allowed: true, consumed: true }), refundPaidCrawlBudget: async () => {} });
		expect(await comprehensive(event(command.detail), context(), () => {})).toEqual({ batchItemFailures: [] });
		const emitted = test.published.find(record => record.detailType === RecrawlContentExtractedEvent.detailType); assert(emitted);
		expect(await initRecrawlContentExtractedHandler(test.selectorDeps)(event(emitted.detail), context(), () => {})).toEqual({ batchItemFailures: [] });
		const row = await test.store.load(SOURCE); assert(row);
		const selected = test.sources.get(row.contentSelection?.candidateId ?? ""); assert(selected);
		expect(test.requested).toEqual([SOURCE, PDF, SOURCE, PDF]);
		expect(extractPdf).toHaveBeenCalledTimes(1);
		expect(test.adoptDestination).toHaveBeenCalledTimes(0);
		expect(selected.metadata).toMatchObject({ originalUrl: SOURCE, sourceUrl: PDF, attemptId: "synthetic-pdf-attempt", kind: "live" });
		expect(row.crawl).toEqual({ kind: "ready" });
		expect(row.freshness.canonicalContentHash).toBe(computeCanonicalContentHash(selected.html));
		expect(test.effects.mock.calls.map(([effect]) => effect)).toContainEqual({ kind: "publish-canonical-content-changed", url: SOURCE });
	});
});
