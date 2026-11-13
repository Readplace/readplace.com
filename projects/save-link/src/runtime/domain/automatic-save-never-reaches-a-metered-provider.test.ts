import { type SaveAttemptId, SaveAttemptIdSchema, validateSaveableUrl } from "@packages/domain/article";
import type { SaveTrigger } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { noopLogger } from "@packages/logger";
import {
	type Article,
	type Effect,
	initTransitionAndPersist,
	markCrawlAwaitingReader,
	markCrawlBlocked,
} from "@packages/domain/article-aggregate";
import type { DeferredMeteredLeg } from "@packages/article-state-types";
import type { MeteredLeg } from "@packages/provider-contracts/metered-leg-ledger";
import type { CreateDeepseekChatCompletion } from "@packages/ai-message";
import type { CrawlAndFinalizeResult } from "@packages/finalize-article";
import { TierContentExtractedEvent } from "@packages/infra-components";
import type { PublishEvent } from "@packages/infra-components/runtime";
import { candidateProvenance, type VerifiedTierSource } from "@packages/tier-source";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initInMemoryArticleStore as initInMemoryArticleAggregateStore } from "@packages/test-fixtures/providers/article-aggregate";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryMeteredLegLedger } from "@packages/test-fixtures/providers/metered-leg-ledger";
import { buildLambdaContext } from "@packages/test-fixtures/lambda-context";
import { buildSqsEvent } from "@packages/test-fixtures/sqs";
import type { SQSEvent } from "aws-lambda";
import type { DeferredUnsupportedKind } from "../dep-bundles/events";
import { initRunMeteredLeg } from "./metered-leg/run-metered-leg";
import { initSubmitLinkCommandHandler } from "./submit-link/submit-link-command-handler";
import { initSelectMostCompleteContent } from "./select-content/select-content";
import { initSelectMostCompleteContentHandler } from "./select-content/select-most-complete-content-handler";
import { initGenerateSummaryHandler } from "./generate-summary/generate-summary-handler";

const URL = "https://example.com/article";
const NOW = new Date("2026-11-05T00:00:00.000Z");
const userId = UserIdSchema.parse("00000000000000000000000000000001");
const LONG_BODY = `<article><h1>Article</h1><p>${"word ".repeat(120)}</p></article>`;
const SHORT_BODY = "<article><h1>Article</h1><p>A short body the judge would weigh.</p></article>";

type Tier1Outcome = { outcome: string; result: CrawlAndFinalizeResult };

function fetched(params: { html: string; wordCount: number; httpStatus?: number }): CrawlAndFinalizeResult {
	return {
		status: "fetched",
		article: { html: params.html, metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: params.wordCount, estimatedReadTime: 1, imageUrl: undefined } },
		evaluationHtml: params.html,
		bodyHash: "a".repeat(64),
		httpStatus: params.httpStatus,
	};
}

const TIER_1_OUTCOMES: readonly Tier1Outcome[] = [
	{ outcome: "a lone body of 100 words or more", result: fetched({ html: LONG_BODY, wordCount: 120 }) },
	{ outcome: "a short body", result: fetched({ html: SHORT_BODY, wordCount: 7 }) },
	{ outcome: "an HTTP 403 body", result: fetched({ html: "<p>Verify you are human</p>", wordCount: 4, httpStatus: 403 }) },
	{ outcome: "javascript-required", result: { status: "unsupported", reason: "javascript required", unsupportedReason: { kind: "javascript-required" } } },
	{ outcome: "blocked", result: { status: "blocked", httpStatus: 403 } },
	{ outcome: "a tracker redirect that defers with its finalUrl", result: { status: "unsupported", reason: "javascript required", unsupportedReason: { kind: "javascript-required" }, finalUrl: "https://example.com/landed" } },
	{ outcome: "non-html-content", result: { status: "unsupported", reason: "pdf", unsupportedReason: { kind: "non-html-content", contentType: "application/pdf" } } },
	{ outcome: "paywall", result: { status: "unsupported", reason: "paywall", unsupportedReason: { kind: "paywall" } } },
	{ outcome: "content-too-large", result: { status: "unsupported", reason: "too large", unsupportedReason: { kind: "content-too-large", bytes: 50_000_000 } } },
];

function pendingArticle(): Article {
	return {
		url: URL, metadata: { title: "", siteName: "example.com", excerpt: "", wordCount: 0 }, freshness: { contentFetchedAt: NOW.toISOString() }, estimatedReadTime: 1,
		crawl: { kind: "pending", pendingSince: NOW.toISOString() }, summary: { kind: "pending", pendingSince: NOW.toISOString() }, summaryAutoHeal: { attempts: 0 },
	};
}

function tierSource(params: { html: string; wordCount: number; httpStatus: number | undefined; attemptId: SaveAttemptId }): VerifiedTierSource {
	return {
		tier: "tier-1", html: params.html,
		metadata: candidateProvenance({
			metadata: { title: "Article", siteName: "example.com", excerpt: "Excerpt", wordCount: params.wordCount, estimatedReadTime: 1 },
			html: params.html, evaluationHtml: params.html, attemptId: params.attemptId, originalUrl: URL, sourceUrl: URL,
			kind: "live", fetchedAt: NOW.toISOString(), httpStatus: params.httpStatus,
		}),
	};
}

function sqs(detail: unknown, messageId: string): SQSEvent {
	return buildSqsEvent([{ messageId, body: JSON.stringify({ time: "2026-06-02T00:00:00Z", detail }) }]);
}

function initPipeline(tier1: CrawlAndFinalizeResult) {
	const userStore = initInMemoryArticleStore();
	const aggregates = initInMemoryArticleAggregateStore();
	aggregates.seed(pendingArticle());
	const crawl = initInMemoryArticleCrawl({ now: () => new Date() });
	const ledger = initInMemoryMeteredLegLedger({ isMeteredLegsDeferred: crawl.isMeteredLegsDeferred, now: () => NOW });
	const runMeteredLeg = initRunMeteredLeg({ ...ledger, logger: noopLogger, now: () => NOW });
	const metered: Record<"judge" | "summary" | MeteredLeg, number> = {
		judge: 0, summary: 0, "render-residential-per-gb": 0, "render-web-unlocker-fetch": 0, "render-web-unlocker-render": 0, comprehensive: 0, "content-judge": 0,
	};
	const pending: Promise<unknown>[] = [];
	const effects: Effect[] = [];
	const { transitionAndPersist } = initTransitionAndPersist({
		store: aggregates,
		dispatchEffect: async (effect) => { effects.push(effect); },
		logCrawlSettled: () => {},
	});

	const createChatCompletion: CreateDeepseekChatCompletion = async () => {
		metered.judge += 1;
		throw new Error("the DeepSeek judge was reached");
	};
	const sources: VerifiedTierSource[] = [];
	const select = initSelectMostCompleteContentHandler({
		listAvailableTierSources: async () => sources,
		selectMostCompleteContent: initSelectMostCompleteContent({ logger: noopLogger, deepseekCallFailedLog: noopLogger, createChatCompletion }).selectMostCompleteContent,
		runMeteredLeg,
		writeCanonicalContent: async ({ source }) => ({ contentLocation: "s3://content/immutable.html", candidateId: source.metadata.id, originalUrl: URL, tier: source.tier }),
		recordCrawlVersion: async () => {},
		readCanonicalContent: async () => undefined, loadArticle: aggregates.load, transitionAndPersist,
		resolveOriginalUrl: async () => URL, verifyWrapperSource: async () => undefined,
		fetchYouTubeVideoCard: async () => undefined, putTierSource: async (params) => params.metadata,
		now: () => NOW, logger: noopLogger, deepseekCallFailedLog: noopLogger,
	});

	const summarize = initGenerateSummaryHandler({
		summarizeArticle: async () => {
			metered.summary += 1;
			throw new Error("the DeepSeek summariser was reached");
		},
		runMeteredLeg,
		findArticleContent: async () => (sources[0] === undefined ? undefined : { content: sources[0].html }),
		loadArticle: aggregates.load,
		transitionAndPersist,
		now: () => NOW,
		logger: noopLogger,
		deepseekCallFailedLog: noopLogger,
	});

	const paidCrawl = async (params: { unsupportedReason: DeferredUnsupportedKind; claimId: string }) => {
		const blockEvidence = params.unsupportedReason === "blocked";
		const leg: DeferredMeteredLeg = params.unsupportedReason === "non-html-content" || params.unsupportedReason === "paywall" ? "comprehensive" : "render-residential-per-gb";
		const ran = await runMeteredLeg({
			url: URL, leg, inputs: [String(params.unsupportedReason)], claimId: params.claimId, claimTtlMs: 60_000,
			run: async () => {
				metered[leg] += 1;
				await new Promise((resolve) => setImmediate(resolve));
				return { kind: "succeeded", outcome: leg };
			},
		});
		if (ran.kind !== "deferred") return;
		if (blockEvidence) await transitionAndPersist(markCrawlBlocked, { url: URL, input: { reason: { kind: "blocked", cause: "edge-block" } } });
		else await transitionAndPersist(markCrawlAwaitingReader, { url: URL, input: { deferredLeg: leg } });
	};

	const deferredReasons: DeferredUnsupportedKind[] = [];
	const publishEvent: PublishEvent = async (event, detail) => {
		if (event.detailType !== TierContentExtractedEvent.detailType) return;
		const parsed = TierContentExtractedEvent.detailSchema.parse(detail);
		const source = tier1.status === "fetched"
			? tierSource({ html: tier1.article.html, wordCount: tier1.article.metadata.wordCount, httpStatus: tier1.httpStatus, attemptId: parsed.saveAttemptId })
			: undefined;
		if (source === undefined) return;
		sources.push(source);
		pending.push(Promise.resolve(select(sqs({ ...parsed, candidates: [{ id: source.metadata.id, tier: source.tier }] }, "select"), buildLambdaContext(), () => {})));
	};

	const submit = initSubmitLinkCommandHandler({
		verifyWrapperSource: async ({ articleUrl, sourceUrl }) => ({ originalUrl: articleUrl, sourceUrl }),
		resolveOriginalUrl: async (url) => url,
		validateSaveableUrl,
		saveArticleAsRequested: userStore.saveArticleAsRequested,
		allocateSavedAt: userStore.allocateSavedAt,
		saveReadlistArticleAsRequested: userStore.saveReadlistArticleAsRequested,
		updateArticleStatusAcrossReadlists: userStore.updateArticleStatusAcrossReadlists,
		assignSavedArticleToReadlist: userStore.assignSavedArticleToReadlist,
		hasSaveLandedSince: userStore.hasSaveLandedSince,
		resolveSubmitterStanding: async () => "may-save",
		resolveSaveIdentity: async (url) => ({ status: "resolved", url, originalUrl: url }),
		recordInboxArticleQueued: async () => {},
		updateArticleStatus: userStore.updateArticleStatus,
		markCrawlPending: crawl.markCrawlPending,
		markSummaryPending: async () => {},
		publishUpdateFetchTimestamp: async () => {},
		refreshArticleIfStale: async ({ url }) => ({ action: "new", identity: { status: "resolved", url, originalUrl: url } }),
		pinContentSource: async () => {},
		crawlAndFinalizeArticle: async () => tier1,
		emitSimpleCrawlUnsupported: async ({ unsupportedReason }) => { deferredReasons.push(unsupportedReason); },
		putTierSource: async (params) => params.metadata,
		updateFetchTimestamp: async () => {},
		transitionAndPersist,
		markCrawlStage: async () => {},
		adoptCanonicalIdentity: async () => {},
		isSiteRuleUrl: () => false,
		publishEvent,
		now: () => NOW,
		logger: noopLogger,
		logParseError: () => {},
		logCrawlOutcome: () => {},
		readTierSnapshot: async () => ({ tier0Status: "not_attempted", tier1Status: "not_attempted", pickedTier: "none" }),
	});

	async function drain(claimIds: readonly string[]): Promise<void> {
		while (pending.length > 0) await Promise.all(pending.splice(0));
		await Promise.all(deferredReasons.flatMap((unsupportedReason) => claimIds.map((claimId) => paidCrawl({ unsupportedReason, claimId }))));
		const summaries = effects.splice(0).filter((effect) => effect.kind === "generate-summary" || effect.kind === "publish-canonical-content-changed");
		await Promise.all(summaries.flatMap(({ url }) => claimIds.map((claimId) => summarize(sqs({ url }, claimId), buildLambdaContext(), () => {}))));
	}

	async function save(saveTrigger: SaveTrigger): Promise<void> {
		const saveAttemptId = SaveAttemptIdSchema.parse(`${saveTrigger}-save`);
		await submit(sqs({ url: URL, userId, saveAttemptId, provenance: { kind: "web" }, saveTrigger, readlist: "default" }, "submit"), buildLambdaContext(), () => {});
		await drain(["save"]);
	}

	async function resolveOnView(): Promise<void> {
		crawl.resumeMeteredLegs(URL);
		aggregates.seed(pendingArticle());
		await drain(["resolve-a", "resolve-b"]);
	}

	return { save, resolveOnView, metered, row: () => aggregates.load(URL), isDeferred: () => crawl.isMeteredLegsDeferred(URL) };
}

type Parked = "ready, summary awaiting a reader" | "awaiting a reader" | "blocked with the paid legs owed" | "a free terminal state";

const EXPECTED: Record<string, Parked> = {
	"a lone body of 100 words or more": "ready, summary awaiting a reader",
	"a short body": "awaiting a reader",
	"an HTTP 403 body": "blocked with the paid legs owed",
	"javascript-required": "awaiting a reader",
	blocked: "blocked with the paid legs owed",
	"a tracker redirect that defers with its finalUrl": "awaiting a reader",
	"non-html-content": "awaiting a reader",
	paywall: "awaiting a reader",
	"content-too-large": "a free terminal state",
};

function shapeOf(row: Article | undefined, deferred: boolean): Parked | "pending" | "other" {
	if (row === undefined || row.crawl.kind === "pending" || row.summary.kind === "pending") return "pending";
	if (row.crawl.kind === "ready" && row.summary.kind === "skipped" && row.summary.reason === "awaiting-reader") return "ready, summary awaiting a reader";
	if (row.crawl.kind === "unsupported" && row.crawl.reason.kind === "awaiting-reader" && row.summary.kind === "skipped" && row.summary.reason === "awaiting-reader") return "awaiting a reader";
	if (row.crawl.kind === "failed" && row.crawl.reason.kind === "blocked" && deferred) return "blocked with the paid legs owed";
	if (row.crawl.kind === "failed" || (row.crawl.kind === "unsupported" && row.crawl.reason.kind !== "awaiting-reader")) return "a free terminal state";
	return "other";
}

const NO_METERED_CALLS = { judge: 0, summary: 0, "render-residential-per-gb": 0, "render-web-unlocker-fetch": 0, "render-web-unlocker-render": 0, comprehensive: 0, "content-judge": 0 };

it.each(TIER_1_OUTCOMES)("an automatic save whose tier-1 fetch returns $outcome parks without reaching a metered provider", async ({ outcome, result }) => {
	const pipeline = initPipeline(result);

	await pipeline.save("automatic");

	expect({ shape: shapeOf(await pipeline.row(), pipeline.isDeferred()), metered: pipeline.metered }).toEqual({ shape: EXPECTED[outcome], metered: NO_METERED_CALLS });
});

it.each([
	{ outcome: "a lone body of 100 words or more", reached: "summary", result: fetched({ html: LONG_BODY, wordCount: 120 }) },
	{ outcome: "a short body", reached: "judge", result: fetched({ html: SHORT_BODY, wordCount: 7 }) },
	{ outcome: "javascript-required", reached: "render-residential-per-gb", result: { status: "unsupported", reason: "javascript required", unsupportedReason: { kind: "javascript-required" } } },
	{ outcome: "paywall", reached: "comprehensive", result: { status: "unsupported", reason: "paywall", unsupportedReason: { kind: "paywall" } } },
] as const)("a manual save whose tier-1 fetch returns $outcome reaches the $reached provider", async ({ reached, result }) => {
	const pipeline = initPipeline(result);

	await pipeline.save("manual");

	expect(pipeline.metered[reached]).toBe(1);
});

const RESOLVED_LEG: Record<string, MeteredLeg | undefined> = {
	"javascript-required": "render-residential-per-gb",
	blocked: "render-residential-per-gb",
	"a tracker redirect that defers with its finalUrl": "render-residential-per-gb",
	"non-html-content": "comprehensive",
	paywall: "comprehensive",
};

it.each(TIER_1_OUTCOMES)("after a view claims an automatic save whose tier-1 fetch returned $outcome, two concurrent resolution records run each metered leg at most once", async ({ outcome, result }) => {
	const pipeline = initPipeline(result);
	await pipeline.save("automatic");

	await pipeline.resolveOnView();

	const leg = RESOLVED_LEG[outcome];
	expect(pipeline.metered).toEqual(leg === undefined ? NO_METERED_CALLS : { ...NO_METERED_CALLS, [leg]: 1 });
});
