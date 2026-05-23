import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { noopLogger } from "@packages/hutch-logger";
import { calculateReadTime, validateSaveableUrl } from "@packages/domain/article";
import type { BotDefenseEvent } from "./providers/auth/bot-defense.types";
import type { ConversionEvent } from "./providers/auth/conversion.types";
import type { ParseArticle } from "@packages/article-parser";
import { initReadabilityParser } from "@packages/article-parser";
import { initInMemoryArticleCrawl } from "./providers/article-crawl/in-memory-article-crawl";
import { initInMemoryArticleStore } from "./providers/article-store/in-memory-article-store";
import { initInMemoryAuth } from "./providers/auth/in-memory-auth";
import { initInMemoryEmail } from "./providers/email/in-memory-email";
import { initInMemoryEmailVerification } from "./providers/email-verification/in-memory-email-verification";
import { initInMemoryPasswordReset } from "./providers/password-reset/in-memory-password-reset";
import { initInMemoryPendingHtml } from "./providers/pending-html/in-memory-pending-html";
import { initInMemoryPendingSignup } from "./providers/pending-signup/in-memory-pending-signup";
import { initInMemoryStripeCheckout } from "./providers/stripe-checkout/in-memory-stripe-checkout";
import { initInMemorySubscriptionProviders } from "./providers/subscription-providers/in-memory-subscription-providers";
import { initInMemoryImportSession } from "./providers/import-session/in-memory-import-session";
import { initInMemorySaveLinkRawHtmlCommand } from "./providers/events/in-memory-save-link-raw-html-command";
import { initInMemoryExportUserDataCommand } from "./providers/events/in-memory-export-user-data-command";
import { initInMemoryCancelSubscriptionCommand } from "./providers/events/in-memory-cancel-subscription-command";
import {
	createOAuthModel,
	initInMemoryOAuthModel,
} from "./providers/oauth/oauth-model";
import { createValidateAccessToken } from "./providers/oauth/validate-access-token";
import type {
	FindGeneratedSummary,
	ForceMarkSummaryPending,
	GeneratedSummary,
	MarkSummaryPending,
} from "./providers/article-summary/article-summary.types";
import { initInMemoryLinkSaved } from "./providers/events/in-memory-link-saved";
import { initInMemoryRecrawlLinkInitiated } from "./providers/events/in-memory-recrawl-link-initiated";
import { initInMemorySaveAnonymousLink } from "./providers/events/in-memory-save-anonymous-link";
import { initInMemoryStaleCheckRequested } from "./providers/events/in-memory-stale-check-requested";
import { initInMemoryUpdateFetchTimestamp } from "./providers/events/in-memory-update-fetch-timestamp";
import type { PublishLinkSaved } from "./providers/events/publish-link-saved.types";
import type { PublishRecrawlLinkInitiated } from "./providers/events/publish-recrawl-link-initiated.types";
import type { PublishSaveAnonymousLink } from "./providers/events/publish-save-anonymous-link.types";
import type {
	HttpErrorMessageMapping,
	RefreshArticleIfStale,
	TestAppFixture,
} from "./bundle.types";


/** Inlined from projects/hutch/src/runtime/web/pages/queue/queue.error.ts.
 * Keep in sync — both locations carry the same wire-format `error_code` →
 * user-facing message map. The duplication exists because the fixture cannot
 * import from hutch (would re-introduce the @packages/test-fixtures → hutch
 * graph edge that this extraction set out to break). */
const SAVE_ERROR_MESSAGES: Record<string, string> = {
	save_failed: "Could not save article. Please try again.",
	import_too_large:
		"That file is too large. The limit is 5 MiB — please email it to readplace+migrate@readplace.com instead.",
	import_no_urls: "We couldn't find any links in that file.",
	import_session_not_found:
		"That import session has expired. Please upload the file again.",
};

const httpErrorMessageMapping: HttpErrorMessageMapping = (query) => {
	const errorCode = typeof query.error_code === "string" ? query.error_code : undefined;
	return errorCode ? SAVE_ERROR_MESSAGES[errorCode] : undefined;
};

/* c8 ignore next -- V8 block-coverage phantom: the const initializer for the first
   `export const arrowFn` in this module is reported as an uncovered function even
   though every test exercises it. See https://github.com/bcoe/c8/issues/319 and
   https://v8.dev/blog/javascript-code-coverage. */
export const stubCrawlArticle: CrawlArticle = async ({ url }) => {
	const hostname = new URL(url).hostname;
	return {
		status: "fetched",
		html: `<html><head><title>Article from ${hostname}</title></head><body><article><p>Content saved from ${hostname}.</p></article></body></html>`,
	};
};

export const createNoopRefreshArticleIfStale = (): RefreshArticleIfStale =>
	async () => ({ action: "new" });

export const createInMemoryPublishUpdateFetchTimestamp = () =>
	initInMemoryUpdateFetchTimestamp({ logger: noopLogger }).publishUpdateFetchTimestamp;

export const createNoopLogError = (): ((msg: string, err?: Error) => void) =>
	() => {};

export function createFakeSummaryProvider(opts?: { readyAfterReads?: number }): {
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	forceMarkSummaryPending: ForceMarkSummaryPending;
	markSummaryReady: (params: { url: string; summary: string; excerpt: string }) => void;
} {
	// Test-only fake for the Deepseek-backed summary generation. Local E2E
	// doesn't call a real LLM, so we simulate the pending → ready transition
	// by counting reads of a pending row and flipping it once the count hits
	// readyAfterReads. Default (no opts) = stays pending forever, so unit/route
	// tests get deterministic HTML. E2E opts in (e.g. readyAfterReads: 3) to
	// exercise the polling UI end-to-end without depending on wall-clock time.
	const state = new Map<string, GeneratedSummary>();
	const reads = new Map<string, number>();
	const findGeneratedSummary: FindGeneratedSummary = async (url) => {
		const id = ArticleResourceUniqueId.parse(url).value;
		const current = state.get(id);
		if (opts?.readyAfterReads !== undefined && current?.status === "pending") {
			const count = (reads.get(id) ?? 0) + 1;
			reads.set(id, count);
			if (count >= opts.readyAfterReads) {
				state.set(id, { status: "ready", summary: `Fake summary for ${url}.` });
			}
		}
		return state.get(id);
	};
	const markSummaryPending: MarkSummaryPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url).value;
		if (state.get(id)?.status === "ready") return;
		state.set(id, { status: "pending" });
		reads.set(id, 0);
	};
	const forceMarkSummaryPending: ForceMarkSummaryPending = async ({ url }) => {
		const id = ArticleResourceUniqueId.parse(url).value;
		state.set(id, { status: "pending" });
		reads.set(id, 0);
	};
	const markSummaryReady = ({ url, summary, excerpt }: { url: string; summary: string; excerpt: string }) => {
		const id = ArticleResourceUniqueId.parse(url).value;
		state.set(id, { status: "ready", summary, excerpt });
		reads.set(id, 0);
	};
	return { findGeneratedSummary, markSummaryPending, forceMarkSummaryPending, markSummaryReady };
}

export function createFakeApplyParseResult(deps: {
	articleStore: ReturnType<typeof initInMemoryArticleStore>;
	articleCrawl: ReturnType<typeof initInMemoryArticleCrawl>;
	parseArticle: ParseArticle;
}): (url: string) => Promise<void> {
	// Test-only fixture for the async crawl worker: parses (using the injected
	// parseArticle so test cases can simulate parse failures or specific
	// metadata), writes parsed metadata + content, then flips crawlStatus
	// before the awaited publish returns. This makes the route test render
	// the post-worker state in a single synchronous request.
	return async (url) => {
		const result = await deps.parseArticle(url);
		if (!result.ok) {
			await deps.articleCrawl.markCrawlFailed({ url, reason: result.reason });
			return;
		}
		const estimatedReadTime = calculateReadTime(result.article.wordCount);
		await deps.articleStore.writeMetadata({
			url,
			metadata: {
				title: result.article.title,
				siteName: result.article.siteName,
				excerpt: result.article.excerpt,
				wordCount: result.article.wordCount,
				...(result.article.imageUrl ? { imageUrl: result.article.imageUrl } : {}),
			},
			estimatedReadTime,
		});
		await deps.articleStore.writeContent({ url, content: result.article.content });
		await deps.articleCrawl.markCrawlReady({ url });
	};
}

export function createFakePublishLinkSaved(
	applyParseResult: (url: string) => Promise<void>,
): PublishLinkSaved {
	const { publishLinkSaved: log } = initInMemoryLinkSaved({ logger: noopLogger });
	return async (params) => {
		await log(params);
		await applyParseResult(params.url);
	};
}

export function createFakePublishSaveAnonymousLink(
	applyParseResult: (url: string) => Promise<void>,
): PublishSaveAnonymousLink {
	const { publishSaveAnonymousLink: log } = initInMemorySaveAnonymousLink({ logger: noopLogger });
	return async (params) => {
		await log(params);
		await applyParseResult(params.url);
	};
}

export function createFakePublishRecrawlLinkInitiated(
	applyParseResult: (url: string) => Promise<void>,
): PublishRecrawlLinkInitiated {
	const { publishRecrawlLinkInitiated: log } = initInMemoryRecrawlLinkInitiated({ logger: noopLogger });
	return async (params) => {
		await log(params);
		await applyParseResult(params.url);
	};
}

export const TEST_APP_ORIGIN = "http://localhost:3000";

export function createDefaultTestAppFixture(appOrigin: string): TestAppFixture {

	const fastHashPassword = async (p: string) => `plain:${p}`;
	const fastVerifyPassword = async (p: string, stored: string | undefined) => stored === `plain:${p}`;
	const auth = initInMemoryAuth({ hashPassword: fastHashPassword, verifyPassword: fastVerifyPassword });
	const articleStoreMemory = initInMemoryArticleStore();
	const articleCrawl = initInMemoryArticleCrawl();
	const crawlArticle = stubCrawlArticle;
	const { parseArticle } = initReadabilityParser({
		crawlArticle,
		sitePreParsers: [],
		logError: createNoopLogError(),
	});
	const applyParseResult = createFakeApplyParseResult({
		articleStore: articleStoreMemory,
		articleCrawl,
		parseArticle,
	});
	const summary = createFakeSummaryProvider();
	const email = initInMemoryEmail();
	const emailVerification = initInMemoryEmailVerification();
	const passwordReset = initInMemoryPasswordReset();
	const pendingHtml = initInMemoryPendingHtml();
	const { publishSaveLinkRawHtmlCommand } = initInMemorySaveLinkRawHtmlCommand({
		logger: noopLogger,
	});
	const { publishExportUserDataCommand } = initInMemoryExportUserDataCommand({
		logger: noopLogger,
	});
	const { publishCancelSubscriptionCommand } = initInMemoryCancelSubscriptionCommand({
		logger: noopLogger,
	});
	const oauthModel = createOAuthModel(initInMemoryOAuthModel(), { appOrigin });
	const stripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() });
	const pendingSignup = initInMemoryPendingSignup();
	const subscriptionProviders = initInMemorySubscriptionProviders({ now: () => new Date() });

	const botDefenseEvents: BotDefenseEvent[] = [];
	/** Shared capture handler for every level — production code only ever calls
	 * .info(), so the other levels collapse onto the same function. Avoids per-
	 * level no-op closures that V8 reports as uncovered functions. */
	const capture = (data: BotDefenseEvent) => { botDefenseEvents.push(data); };
	const botDefenseLogger: HutchLogger.Typed<BotDefenseEvent> = {
		info: capture,
		error: capture,
		warn: capture,
		debug: capture,
	};

	const conversionEvents: ConversionEvent[] = [];
	const captureConversion = (data: ConversionEvent) => { conversionEvents.push(data); };
	const conversionLogger: HutchLogger.Typed<ConversionEvent> = {
		info: captureConversion,
		error: captureConversion,
		warn: captureConversion,
		debug: captureConversion,
	};

	return {
		auth: { ...auth, hashPassword: fastHashPassword },
		articleStore: {
			findArticleById: articleStoreMemory.findArticleById,
			findArticleByUrl: articleStoreMemory.findArticleByUrl,
			findArticleUrlById: articleStoreMemory.findArticleUrlById,
			findArticleFreshness: articleStoreMemory.findArticleFreshness,
			findArticlesByUser: articleStoreMemory.findArticlesByUser,
			saveArticle: articleStoreMemory.saveArticle,
			saveArticleGlobally: articleStoreMemory.saveArticleGlobally,
			bumpArticleSavedAt: articleStoreMemory.bumpArticleSavedAt,
			deleteArticle: articleStoreMemory.deleteArticle,
			updateArticleStatus: articleStoreMemory.updateArticleStatus,
			readArticleContent: (url) =>
				articleStoreMemory.readContent(ArticleResourceUniqueId.parse(url)),
			readContent: articleStoreMemory.readContent,
			writeContent: articleStoreMemory.writeContent,
			writeMetadata: articleStoreMemory.writeMetadata,
			setContentSourceTier: articleStoreMemory.setContentSourceTier,
		},
		articleCrawl: {
			findArticleCrawlStatus: articleCrawl.findArticleCrawlStatus,
			markCrawlPending: articleCrawl.markCrawlPending,
			forceMarkCrawlPending: articleCrawl.forceMarkCrawlPending,
			markCrawlReady: articleCrawl.markCrawlReady,
			markCrawlFailed: articleCrawl.markCrawlFailed,
			markCrawlUnsupported: articleCrawl.markCrawlUnsupported,
			markCrawlStage: articleCrawl.markCrawlStage,
		},
		parser: { parseArticle, crawlArticle },
		events: {
			publishLinkSaved: createFakePublishLinkSaved(applyParseResult),
			publishRecrawlLinkInitiated: createFakePublishRecrawlLinkInitiated(applyParseResult),
			publishSaveAnonymousLink: createFakePublishSaveAnonymousLink(applyParseResult),
			publishSaveLinkRawHtmlCommand,
			publishStaleCheckRequested: initInMemoryStaleCheckRequested({ logger: noopLogger }).publishStaleCheckRequested,
			publishUpdateFetchTimestamp: createInMemoryPublishUpdateFetchTimestamp(),
			publishExportUserDataCommand,
			publishCancelSubscriptionCommand,
		},
		pendingHtml: {
			putPendingHtml: pendingHtml.putPendingHtml,
			readPendingHtml: pendingHtml.readPendingHtml,
		},
		summary,
		freshness: { refreshArticleIfStale: createNoopRefreshArticleIfStale() },
		oauth: {
			oauthModel,
			validateAccessToken: createValidateAccessToken(oauthModel),
		},
		email,
		emailVerification,
		passwordReset,
		google: undefined,
		admin: {
			adminEmails: [],
			recrawlServiceToken: "test-service-token-abcdefghij",
		},
		importSession: {
			importSessionStore: initInMemoryImportSession({ now: () => new Date() }),
		},
		shared: {
			validateSaveableUrl,
			appOrigin,
			staticBaseUrl: "https://static.test",
			httpErrorMessageMapping,
			logError: createNoopLogError(),
			logParseError: () => {},
			now: () => new Date(),
		},
		stripe,
		pendingSignup,
		subscriptionProviders,
		botDefense: { logger: botDefenseLogger, events: botDefenseEvents },
		conversions: { logger: conversionLogger, events: conversionEvents },
		/** Small enough that founding-allocation seed loops finish in
		 * milliseconds while still leaving room for "one above the limit" tests
		 * to seed N+1 distinct emails. Production injects 50 via app.ts. */
		foundingAllocation: { foundingMemberLimit: 3 },
	};
}
