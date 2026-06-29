import { createHash } from "node:crypto";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import { noopLogger } from "@packages/hutch-logger";
import { calculateReadTime, validateSaveableUrl } from "@packages/domain/article";
import type {
	BotDefenseEvent,
	ConversionEvent,
} from "@packages/provider-contracts/auth";
import type { ParseArticle } from "@packages/article-parser";
import { initReadabilityParser } from "@packages/article-parser";
import { initInMemoryArticleCrawl } from "./providers/article-crawl/in-memory-article-crawl";
import { initInMemoryArticleStore } from "./providers/article-store/in-memory-article-store";
import { initInMemoryAuth } from "./providers/auth/in-memory-auth";
import { initInMemoryEmail } from "./providers/email/in-memory-email";
import { initInMemoryEmailVerification } from "./providers/email-verification/in-memory-email-verification";
import { initInMemoryPasswordReset } from "./providers/password-reset/in-memory-password-reset";
import { initInMemoryRateLimit } from "./providers/rate-limit/in-memory-rate-limit";
import { initInMemoryIosOnboardingSignal } from "./providers/ios-onboarding-signal/in-memory-ios-onboarding-signal";
import { initInMemoryPendingHtml } from "./providers/pending-html/in-memory-pending-html";
import { initInMemoryPendingPdf } from "./providers/pending-pdf/in-memory-pending-pdf";
import { initInMemoryPendingSignup } from "./providers/pending-signup/in-memory-pending-signup";
import { initInMemoryStripeCheckout } from "./providers/stripe-checkout/in-memory-stripe-checkout";
import { initInMemoryStripeSubscriptions } from "./providers/stripe-subscriptions/in-memory-stripe-subscriptions";
import { initInMemorySubscriptionProviders } from "./providers/subscription-providers/in-memory-subscription-providers";
import { initInMemoryPaymentMethods } from "./providers/payment-methods/in-memory-payment-methods";
import { initInMemoryTrialScheduler } from "./providers/trial-scheduler/in-memory-trial-scheduler";
import { initInMemoryImportSession } from "./providers/import-session/in-memory-import-session";
import { initInMemoryInboxAddress } from "./providers/inbox-address/in-memory-inbox-address";
import { initInMemoryInboxEmail } from "./providers/inbox-email/in-memory-inbox-email";
import { initInMemoryInboxEmailLink } from "./providers/inbox-email/in-memory-inbox-email-link";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import { initInMemorySaveLinkRawHtmlCommand } from "./providers/events/in-memory-save-link-raw-html-command";
import { initInMemorySaveLinkRawPdfCommand } from "./providers/events/in-memory-save-link-raw-pdf-command";
import { initInMemoryExportUserDataCommand } from "./providers/events/in-memory-export-user-data-command";
import { initInMemoryCancelSubscriptionCommand } from "./providers/events/in-memory-cancel-subscription-command";
import { initInMemorySubscriptionReactivated } from "./providers/events/in-memory-subscription-reactivated";
import {
	createOAuthModel,
	initInMemoryOAuthModel,
} from "./providers/oauth/oauth-model";
import { initInMemoryOAuthClients } from "./providers/oauth/in-memory-oauth-clients";
import { initOAuthClientLookup } from "@packages/domain/oauth";
import { createValidateAccessToken } from "./providers/oauth/validate-access-token";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import { initInMemoryLinkSaved } from "./providers/events/in-memory-link-saved";
import { initInMemoryRecrawlLinkInitiated } from "./providers/events/in-memory-recrawl-link-initiated";
import { initInMemorySaveAnonymousLink } from "./providers/events/in-memory-save-anonymous-link";
import { initInMemoryStaleCheckRequested } from "./providers/events/in-memory-stale-check-requested";
import { initInMemoryUpdateFetchTimestamp } from "./providers/events/in-memory-update-fetch-timestamp";
import type {
	PublishLinkSaved,
	PublishRecrawlLinkInitiated,
	PublishSaveAnonymousLink,
} from "@packages/provider-contracts/events";
import type {
	HttpErrorMessageMapping,
	RefreshArticleIfStale,
	TestAppFixture,
} from "./bundle.types";


/** Duplicates the application's wire-format `error_code` → user-facing message
 * map. The fixture cannot import that map from the application package without
 * re-introducing a dependency cycle, so both copies must be kept consistent. */
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
	const html = `<html><head><title>Article from ${hostname}</title></head><body><article><p>Content saved from ${hostname}.</p></article></body></html>`;
	return {
		status: "fetched",
		html,
		bodyHash: createHash("sha256").update(html).digest("hex"),
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
	const markSummaryReady = ({ url, summary, excerpt }: { url: string; summary: string; excerpt: string }) => {
		const id = ArticleResourceUniqueId.parse(url).value;
		state.set(id, { status: "ready", summary, excerpt });
		reads.set(id, 0);
	};
	return { findGeneratedSummary, markSummaryPending, markSummaryReady };
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

export const stubExtractLinksFromPageUrl: ExtractLinksFromPageUrl = async () => ({
	status: "OK",
	links: {
		urls: ["https://example.com/a", "https://example.com/b"],
		truncated: false,
		totalFound: 2,
	},
});

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
		siteRules: [],
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
	/* Generous enough that no unrelated suite ever trips a limiter; tests that
	 * exercise 429 behaviour override the bundle with tight rules. */
	const unlimitedRule = { limit: 10_000, windowSeconds: 3600 };
	const rateLimit = {
		consumeRateLimit: initInMemoryRateLimit({ now: () => new Date() }).consumeRateLimit,
		rules: {
			viewCrawl: unlimitedRule,
			login: unlimitedRule,
			signup: unlimitedRule,
			forgotPassword: unlimitedRule,
			oauthRegister: unlimitedRule,
		},
	};
	const pendingHtml = initInMemoryPendingHtml();
	const pendingPdf = initInMemoryPendingPdf();
	const { publishSaveLinkRawHtmlCommand } = initInMemorySaveLinkRawHtmlCommand({
		logger: noopLogger,
	});
	const { publishSaveLinkRawPdfCommand } = initInMemorySaveLinkRawPdfCommand({
		logger: noopLogger,
	});
	const { publishExportUserDataCommand } = initInMemoryExportUserDataCommand({
		logger: noopLogger,
	});
	const { publishCancelSubscriptionCommand } = initInMemoryCancelSubscriptionCommand({
		logger: noopLogger,
	});
	const { publishSubscriptionReactivated } = initInMemorySubscriptionReactivated({
		logger: noopLogger,
	});
	const oauthClients = initInMemoryOAuthClients({ now: () => new Date() });
	const oauthClientLookup = initOAuthClientLookup({ dynamic: oauthClients });
	const oauthModel = createOAuthModel(initInMemoryOAuthModel(), {
		appOrigin,
		findUserById: auth.findUserById,
		findClient: oauthClientLookup.findClient,
		markClientActive: oauthClientLookup.markClientActive,
	});
	const stripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() });
	const pendingSignup = initInMemoryPendingSignup();
	const subscriptionProviders = initInMemorySubscriptionProviders({ now: () => new Date() });
	const trialScheduler = initInMemoryTrialScheduler();
	const stripeSubscriptions = initInMemoryStripeSubscriptions();
	const paymentMethods = initInMemoryPaymentMethods();

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
			countArticlesByUser: articleStoreMemory.countArticlesByUser,
			saveArticle: articleStoreMemory.saveArticle,
			saveArticleGlobally: articleStoreMemory.saveArticleGlobally,
			bumpArticleSavedAt: articleStoreMemory.bumpArticleSavedAt,
			deleteArticle: articleStoreMemory.deleteArticle,
			updateArticleStatus: articleStoreMemory.updateArticleStatus,
			markArticleViewed: articleStoreMemory.markArticleViewed,
			markSummaryToggled: articleStoreMemory.markSummaryToggled,
			markReaderViewSucceeded: articleStoreMemory.markReaderViewSucceeded,
			findUserArticlesByUrl: articleStoreMemory.findUserArticlesByUrl,
			markReaderReadyEmailSent: articleStoreMemory.markReaderReadyEmailSent,
			findUserArticleNotificationState: articleStoreMemory.findUserArticleNotificationState,
			getSummaryToggleState: articleStoreMemory.getSummaryToggleState,
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
			publishSaveLinkRawPdfCommand,
			publishStaleCheckRequested: initInMemoryStaleCheckRequested({ logger: noopLogger }).publishStaleCheckRequested,
			publishUpdateFetchTimestamp: createInMemoryPublishUpdateFetchTimestamp(),
			publishExportUserDataCommand,
			publishCancelSubscriptionCommand,
			publishSubscriptionReactivated,
		},
		pendingHtml: {
			putPendingHtml: pendingHtml.putPendingHtml,
			readPendingHtml: pendingHtml.readPendingHtml,
		},
		pendingPdf: {
			putPendingPdf: pendingPdf.putPendingPdf,
			readPendingPdfSync: pendingPdf.readPendingPdfSync,
		},
		summary,
		freshness: { refreshArticleIfStale: createNoopRefreshArticleIfStale() },
		oauth: {
			oauthModel,
			validateAccessToken: createValidateAccessToken(oauthModel),
			findClient: oauthClientLookup.findClient,
			validateRedirectUri: oauthClientLookup.validateRedirectUri,
			registerClient: oauthClients.registerClient,
		},
		email,
		emailVerification,
		passwordReset,
		rateLimit,
		iosOnboardingSignal: initInMemoryIosOnboardingSignal(),
		google: undefined,
		admin: {
			adminEmails: [],
			recrawlServiceToken: "test-service-token-abcdefghij",
		},
		importSession: {
			importSessionStore: initInMemoryImportSession({ now: () => new Date() }),
			extractLinksFromPageUrl: stubExtractLinksFromPageUrl,
		},
		inboxAddress: {
			inboxAddressStore: initInMemoryInboxAddress({ now: () => new Date() }),
			inboxAddressDomain: "read.place",
		},
		inboxEmail: {
			inboxEmailStore: initInMemoryInboxEmail(),
			inboxEmailLinkStore: initInMemoryInboxEmailLink(),
			readEmailContent: async () => undefined,
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
		trialScheduler,
		stripeSubscriptions,
		paymentMethods,
		stripePriceId: "price_test_default",
		stripePublishableKey: "pk_test_default",
		botDefense: { logger: botDefenseLogger, events: botDefenseEvents },
		conversions: { logger: conversionLogger, events: conversionEvents },
		/** Small enough that founding-allocation seed loops finish in
		 * milliseconds while still leaving room for "one above the limit" tests
		 * to seed N+1 distinct emails. Production uses a much larger limit. */
		foundingAllocation: { foundingMemberLimit: 3 },
	};
}
