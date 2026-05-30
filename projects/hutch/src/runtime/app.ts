/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import type { Express } from "express";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import type { Logger } from "./domain/logger";
import { initInMemoryAuth, hashPassword, verifyPassword } from "@packages/test-fixtures/providers/auth";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import type { ExtractPdf } from "@packages/crawl-article";
import {
	CRAWL_PERSONAS,
	initCrawlArticle,
	initCrawlFetch,
	initFetchThumbnailImage,
} from "@packages/crawl-article";
import { initExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import { initFinalizeArticle } from "save-link/finalize-article";
import { initCrawlAndFinalizeArticle } from "save-link/crawl-and-finalize-article";
import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import { initReadabilityParser, mediumPreParser, theInformationPreParser } from "@packages/article-parser";
import { initRefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import {
	createOAuthModel,
	initInMemoryOAuthModel,
} from "@packages/test-fixtures/providers/oauth";
import { initDynamoDbOAuthModel } from "./providers/oauth/dynamodb-oauth-model";
import { createValidateAccessToken } from "@packages/test-fixtures/providers/oauth";
import { initLogEmail } from "./providers/email/log-email";
import { initResendEmail } from "./providers/email/resend-email";
import { initInMemoryEmailVerification } from "@packages/test-fixtures/providers/email-verification";
import { initDynamoDbEmailVerification } from "./providers/email-verification/dynamodb-email-verification";
import { initInMemoryPasswordReset } from "@packages/test-fixtures/providers/password-reset";
import { initDynamoDbPasswordReset } from "./providers/password-reset/dynamodb-password-reset";
import { initInMemoryResendThrottle } from "@packages/test-fixtures/providers/resend-throttle";
import { initDynamoDbResendThrottle } from "./providers/resend-throttle/dynamodb-resend-throttle";
import { initDynamoDbGeneratedSummary } from "./providers/article-summary/dynamodb-generated-summary";
import { devSummariseInline } from "./providers/article-summary/dev-summarise-inline";
import { initDynamoDbArticleCrawl } from "./providers/article-crawl/dynamodb-article-crawl";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { initS3ReadContent } from "./providers/article-store/s3-read-content";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { initReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initEventBridgeLinkSaved } from "./providers/events/eventbridge-link-saved";
import { initEventBridgeRecrawlLinkInitiated } from "./providers/events/eventbridge-recrawl-link-initiated";
import { initEventBridgeSaveAnonymousLink } from "./providers/events/eventbridge-save-anonymous-link";
import { initEventBridgeStaleCheckRequested } from "./providers/events/eventbridge-stale-check-requested";
import { initEventBridgeSaveLinkRawHtmlCommand } from "./providers/events/eventbridge-save-link-raw-html-command";
import { initEventBridgeRefreshArticleContent, initPutRefreshHtml } from "@packages/refresh-article-content";
import { initEventBridgeUpdateFetchTimestamp } from "./providers/events/eventbridge-update-fetch-timestamp";
import { initEventBridgeExportUserDataCommand } from "./providers/events/eventbridge-export-user-data-command";
import { initEventBridgeCancelSubscriptionCommand } from "./providers/events/eventbridge-cancel-subscription-command";
import { initEventBridgeSubscriptionReactivated } from "./providers/events/eventbridge-subscription-reactivated";
import {
	initInMemoryCancelSubscriptionCommand,
	initInMemoryExportUserDataCommand,
	initInMemorySubscriptionReactivated,
} from "@packages/test-fixtures/providers/events";
import { initInMemoryLinkSaved } from "@packages/test-fixtures/providers/events";
import { initInMemoryRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveAnonymousLink } from "@packages/test-fixtures/providers/events";
import { initInMemoryStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import { initInMemoryRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import { initInMemoryUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { initPutPendingHtml } from "./providers/pending-html/put-pending-html";
import { initInMemoryPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import { initInMemoryImportSession } from "@packages/test-fixtures/providers/import-session";
import { initDynamoDbImportSession } from "./providers/import-session/dynamodb-import-session";
import { initExchangeGoogleCode } from "./providers/google-auth/google-token";
import { initInMemoryStripeCheckout } from "@packages/test-fixtures/providers/stripe-checkout";
import { initStripeCheckout } from "./providers/stripe-checkout/stripe-checkout";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { initDynamoDbPendingSignup } from "./providers/pending-signup/dynamodb-pending-signup";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initDynamoDbSubscriptionProviders } from "./providers/subscription-providers/dynamodb-subscription-providers";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initLogParseError, type ParseErrorEvent } from "@packages/hutch-infra-components";
import { validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "./server";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { AnalyticsEvent } from "./web/middleware/analytics";
import { httpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { getEnv, requireEnv } from "./domain/require-env";

/**
 * Hutch SSR does not run PDF extraction in-process — the
 * `comprehensive-crawl-command` Lambda owns OCR. When crawlArticle hits a PDF
 * response during a freshness check, this stub fires a StaleCheckRequested
 * event and returns `failed` so refreshArticleIfStale skips inline; the
 * stale-check chain then routes the URL through `SimpleCrawlUnsupportedEvent`
 * → policy → `ComprehensiveCrawlCommand` (refresh=true), letting the
 * comprehensive Lambda re-fetch + OCR and emit `RefreshContentExtractedEvent`
 * without ever pulling mupdf into the hutch or stale-check process.
 */
function createPdfDeferralStub(publishStaleCheckRequested: PublishStaleCheckRequested): ExtractPdf {
	return async ({ url }) => {
		await publishStaleCheckRequested({ url });
		return { kind: "failed", reason: "PDF extraction deferred to stale-check Lambda for vision OCR" };
	};
}

function initProviders() {
	const persistence = requireEnv<"prod" | "development">("PERSISTENCE");
	const logError = (message: string, error?: Error) => console.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack }));

	const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, personas: CRAWL_PERSONAS });
	const staleTtlMs = 86400000;

	if (persistence === "prod") {
		const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
		const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
		const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
		const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
		const oauthTable = requireEnv("DYNAMODB_OAUTH_TABLE");
		const verificationTokensTable = requireEnv("DYNAMODB_VERIFICATION_TOKENS_TABLE");
		const passwordResetTokensTable = requireEnv("DYNAMODB_PASSWORD_RESET_TOKENS_TABLE");
		const resendThrottleTable = requireEnv("DYNAMODB_RESEND_THROTTLE_TABLE");
		const pendingSignupsTable = requireEnv("DYNAMODB_PENDING_SIGNUPS_TABLE");
		const googleClientId = requireEnv("GOOGLE_LOGIN_CLIENT_ID");
		const googleClientSecret = requireEnv("GOOGLE_LOGIN_CLIENT_SECRET");
		const appOriginForRedirect = requireEnv("APP_ORIGIN");
		const resendApiKey = requireEnv("RESEND_API_KEY");
		const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");
		const stripePriceId = requireEnv("STRIPE_PRICE_ID");
		const eventBusName = requireEnv("EVENT_BUS_NAME");
		const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
		const pendingHtmlBucketName = requireEnv("PENDING_HTML_BUCKET_NAME");
		const importSessionsTable = requireEnv("DYNAMODB_IMPORT_SESSIONS_TABLE");
		const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
		const trialSchedulerGroupName = requireEnv("TRIAL_SCHEDULER_GROUP_NAME");
		const trialSchedulerRoleArn = requireEnv("TRIAL_SCHEDULER_ROLE_ARN");
		const eventBusArn = requireEnv("EVENT_BUS_ARN");
		const client = createDynamoDocumentClient();
		const s3Client = new S3Client({});
		const schedulerClient = new SchedulerClient({});

		const auth = initDynamoDbAuth({ client, usersTableName: usersTable, sessionsTableName: sessionsTable });
		const articleStore = initDynamoDbArticleStore({ client, tableName: articlesTable, userArticlesTableName: userArticlesTable });
		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [
				initS3ReadContent({ send: (cmd) => s3Client.send(cmd), bucketName: contentBucketName }),
				articleStore.readContent, // Legacy fallback for articles saved before S3 migration
			],
			logError,
		});
		const oauthModel = initDynamoDbOAuthModel({ client, tableName: oauthTable });
		const summaryStore = initDynamoDbGeneratedSummary({ client, tableName: articlesTable });
		const crawlStore = initDynamoDbArticleCrawl({ client, tableName: articlesTable });
		const { publishEvent } = initEventBridgePublisher({
			client: new EventBridgeClient({}),
			eventBusName,
		});
		const { publishLinkSaved } = initEventBridgeLinkSaved({ publishEvent });
		const { publishRecrawlLinkInitiated } = initEventBridgeRecrawlLinkInitiated({ publishEvent });
		const { publishSaveAnonymousLink } = initEventBridgeSaveAnonymousLink({ publishEvent });
		const { publishStaleCheckRequested } = initEventBridgeStaleCheckRequested({ publishEvent });
		const { publishSaveLinkRawHtmlCommand } = initEventBridgeSaveLinkRawHtmlCommand({ publishEvent });
		const { putRefreshHtml } = initPutRefreshHtml({ client: s3Client, bucketName: pendingHtmlBucketName });
		const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({ publishEvent, putRefreshHtml });
		const { publishUpdateFetchTimestamp } = initEventBridgeUpdateFetchTimestamp({ publishEvent });
		const { publishExportUserDataCommand } = initEventBridgeExportUserDataCommand({ publishEvent });
		const { publishCancelSubscriptionCommand } = initEventBridgeCancelSubscriptionCommand({ publishEvent });
		const { publishSubscriptionReactivated } = initEventBridgeSubscriptionReactivated({ publishEvent });
		const { putPendingHtml } = initPutPendingHtml({ client: new S3Client({}), bucketName: pendingHtmlBucketName });
		const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
		const crawlArticle = initCrawlArticle({ crawlFetch, extractPdf, logError });
		const extractLinksFromPageUrl = initExtractLinksFromPageUrl({ crawlFetch, validateUrl: validateSaveableUrl });
		const { parseHtml } = initReadabilityParser({
			crawlArticle,
			sitePreParsers: [theInformationPreParser, mediumPreParser],
			logError,
		});
		const { refreshArticleIfStale } = initRefreshArticleIfStale({
			findArticleFreshness: articleStore.findArticleFreshness,
			findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
			crawlArticle,
			parseHtml,
			publishRefreshArticleContent,
			publishUpdateFetchTimestamp,
			now: () => new Date(),
			staleTtlMs,
		});
		const googleAuth = {
			exchangeGoogleCode: initExchangeGoogleCode({
				clientId: googleClientId,
				clientSecret: googleClientSecret,
				redirectUri: `${appOriginForRedirect}/auth/google/callback`,
				fetch: globalThis.fetch,
			}),
			clientId: googleClientId,
			clientSecret: googleClientSecret,
		};

		const stripe = initStripeCheckout({
			apiKey: stripeApiKey,
			priceId: stripePriceId,
			fetch: globalThis.fetch,
		});
		const stripeSubscriptions = initStripeSubscriptions({
			apiKey: stripeApiKey,
			fetch: globalThis.fetch,
		});
		const pendingSignup = initDynamoDbPendingSignup({ client, tableName: pendingSignupsTable });
		const subscriptionProviders = initDynamoDbSubscriptionProviders({
			client,
			tableName: subscriptionProvidersTable,
			now: () => new Date(),
		});
		const trialScheduler = initAwsTrialScheduler({
			client: schedulerClient,
			scheduleGroupName: trialSchedulerGroupName,
			schedulerRoleArn: trialSchedulerRoleArn,
			eventBusArn,
		});
		const importSessionStore = initDynamoDbImportSession({
			client,
			tableName: importSessionsTable,
			now: () => new Date(),
		});

		return {
			auth,
			articleStore,
			readArticleContent,
			importSessionStore,
			extractLinksFromPageUrl,
			subscriptionProviders,
			trialScheduler,
			createSubscriptionOnExistingCustomer: stripeSubscriptions.createSubscriptionOnExistingCustomer,
			reverseScheduledCancellation: stripeSubscriptions.reverseScheduledCancellation,
			stripePriceId,

			...initResendEmail(resendApiKey),
			...initDynamoDbEmailVerification({ client, tableName: verificationTokensTable }),
			...initDynamoDbPasswordReset({ client, tableName: passwordResetTokensTable }),
			...initDynamoDbResendThrottle({ client, tableName: resendThrottleTable, now: () => new Date() }),
			...stripe,
			...pendingSignup,
			googleAuth,
			oauthModel,
			validateAccessToken: createValidateAccessToken(oauthModel),
			publishLinkSaved,
			publishRecrawlLinkInitiated,
			publishSaveAnonymousLink,
			publishStaleCheckRequested,
			publishSaveLinkRawHtmlCommand,
			publishUpdateFetchTimestamp,
			publishExportUserDataCommand,
			publishCancelSubscriptionCommand,
			publishSubscriptionReactivated,
			putPendingHtml,
			findGeneratedSummary: summaryStore.findGeneratedSummary,
			markSummaryPending: summaryStore.markSummaryPending,
			findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
			markCrawlPending: crawlStore.markCrawlPending,
			forceMarkCrawlPending: crawlStore.forceMarkCrawlPending,
			refreshArticleIfStale,
		};
	}

	const auth = initInMemoryAuth({ hashPassword, verifyPassword });
	const articleStore = initInMemoryArticleStore();
	const oauthModel = createOAuthModel(initInMemoryOAuthModel());
	const devStripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() });
	const devStripeSubscriptions = initInMemoryStripeSubscriptions();
	const devPendingSignup = initInMemoryPendingSignup();
	const devSubscriptionProviders = initInMemorySubscriptionProviders({ now: () => new Date() });
	const devTrialScheduler = initInMemoryTrialScheduler();
	const devGoogleClientId = getEnv("GOOGLE_LOGIN_CLIENT_ID");
	const devGoogleClientSecret = getEnv("GOOGLE_LOGIN_CLIENT_SECRET");
	assert(
		(devGoogleClientId && devGoogleClientSecret) || (!devGoogleClientId && !devGoogleClientSecret),
		"GOOGLE_LOGIN_CLIENT_ID and GOOGLE_LOGIN_CLIENT_SECRET must both be set or both unset",
	);
	const googleAuth = devGoogleClientId && devGoogleClientSecret
		? {
			exchangeGoogleCode: initExchangeGoogleCode({
				clientId: devGoogleClientId,
				clientSecret: devGoogleClientSecret,
				redirectUri: `http://localhost:${getEnv("PORT") || "3000"}/auth/google/callback`,
				fetch: globalThis.fetch,
			}),
			clientId: devGoogleClientId,
			clientSecret: devGoogleClientSecret,
		}
		: undefined;
	const crawlStore = initInMemoryArticleCrawl();
	const summaryStore = initInMemoryGeneratedSummary();
	const { publishStaleCheckRequested } = initInMemoryStaleCheckRequested({ logger: consoleLogger });
	const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
	const crawlArticle = initCrawlArticle({ crawlFetch, extractPdf, logError });
	const extractLinksFromPageUrl = initExtractLinksFromPageUrl({ crawlFetch, validateUrl: validateSaveableUrl });
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		sitePreParsers: [theInformationPreParser, mediumPreParser],
		logError,
	});
	const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError });
	/* Dev composition: no S3, no CDN. Stub the media + image-upload deps so the
	 * in-memory app still routes through the same `finalizeArticle` pipeline
	 * every prod Lambda uses — identical algorithm, identical metadata shape,
	 * just with no-op upload sinks. */
	const finalizeArticle = initFinalizeArticle({
		parseHtml,
		downloadMedia: async () => [],
		processContent: async ({ html }) => html,
		fetchThumbnailImage,
		putImageObject: async () => {},
		imagesCdnBaseUrl: "https://dev-images.invalid",
	});
	const crawlAndFinalizeArticle = initCrawlAndFinalizeArticle({
		crawlArticle, // dev: crawlArticle is built with extractPdf, so PDFs extract inline
		finalizeArticle,
	});
	const finaliseSummaryFromContent = async (params: { url: string; textContent: string }) => {
		await summaryStore.markSummaryPending({ url: params.url });
		const summary = devSummariseInline({ textContent: params.textContent });
		if (summary.kind === "ready") {
			await summaryStore.markSummaryReady({ url: params.url, summary: summary.summary, excerpt: summary.excerpt });
			return;
		}
		await summaryStore.markSummarySkipped({ url: params.url, reason: summary.reason });
	};
	const runCrawlAndSummariseInline = async (url: string) => {
		const result = await crawlAndFinalizeArticle({ url });
		if (result.status === "unsupported") {
			await crawlStore.markCrawlUnsupported({ url, reason: result.reason });
			return;
		}
		if (result.status === "failed") {
			await crawlStore.markCrawlFailed({ url, reason: result.reason });
			return;
		}
		if (result.status === "not-modified") return;
		await articleStore.writeContent({ url, content: result.article.html });
		await crawlStore.markCrawlReady({ url });
		await finaliseSummaryFromContent({ url, textContent: result.article.html });
	};
	const { publishLinkSaved: logOnlyPublishLinkSaved } = initInMemoryLinkSaved({ logger: consoleLogger });
	const publishLinkSaved: typeof logOnlyPublishLinkSaved = async (params) => {
		await logOnlyPublishLinkSaved(params);
		await runCrawlAndSummariseInline(params.url);
	};
	const { publishSaveAnonymousLink: logOnlyPublishSaveAnonymousLink } = initInMemorySaveAnonymousLink({ logger: consoleLogger });
	const publishSaveAnonymousLink: typeof logOnlyPublishSaveAnonymousLink = async (params) => {
		await logOnlyPublishSaveAnonymousLink(params);
		await runCrawlAndSummariseInline(params.url);
	};
	const { publishRecrawlLinkInitiated: logOnlyPublishRecrawlLinkInitiated } = initInMemoryRecrawlLinkInitiated({ logger: consoleLogger });
	const publishRecrawlLinkInitiated: typeof logOnlyPublishRecrawlLinkInitiated = async (params) => {
		await logOnlyPublishRecrawlLinkInitiated(params);
		await runCrawlAndSummariseInline(params.url);
	};
	const { publishRefreshArticleContent } = initInMemoryRefreshArticleContent({ logger: consoleLogger });
	const { publishUpdateFetchTimestamp } = initInMemoryUpdateFetchTimestamp({ logger: consoleLogger });
	const { publishSaveLinkRawHtmlCommand } = initInMemorySaveLinkRawHtmlCommand({ logger: consoleLogger });
	const { publishExportUserDataCommand } = initInMemoryExportUserDataCommand({ logger: consoleLogger });
	const { publishCancelSubscriptionCommand } = initInMemoryCancelSubscriptionCommand({ logger: consoleLogger });
	const { publishSubscriptionReactivated } = initInMemorySubscriptionReactivated({ logger: consoleLogger });
	const { putPendingHtml } = initInMemoryPendingHtml();
	const { refreshArticleIfStale } = initRefreshArticleIfStale({
		findArticleFreshness: articleStore.findArticleFreshness,
		findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
		crawlArticle,
		parseHtml,
		publishRefreshArticleContent,
		publishUpdateFetchTimestamp,
		now: () => new Date(),
		staleTtlMs,
	});

	const importSessionStore = initInMemoryImportSession({ now: () => new Date() });

	return {
		auth,
		articleStore,
		readArticleContent: initReadArticleContent({
			storageProviderQueryOrder: [articleStore.readContent],
			logError,
		}),
		importSessionStore,
		extractLinksFromPageUrl,
		subscriptionProviders: devSubscriptionProviders,
		trialScheduler: devTrialScheduler,
		createSubscriptionOnExistingCustomer: devStripeSubscriptions.createSubscriptionOnExistingCustomer,
		reverseScheduledCancellation: devStripeSubscriptions.reverseScheduledCancellation,
		stripePriceId: "price_dev_default",

		...initLogEmail(),
		...initInMemoryEmailVerification(),
		...initInMemoryPasswordReset(),
		...initInMemoryResendThrottle({ now: () => new Date() }),
		createCheckoutSession: devStripe.createCheckoutSession,
		retrieveCheckoutSession: devStripe.retrieveCheckoutSession,
		storePendingSignup: devPendingSignup.storePendingSignup,
		consumePendingSignup: devPendingSignup.consumePendingSignup,
		googleAuth,
		oauthModel,
		validateAccessToken: createValidateAccessToken(oauthModel),
		publishLinkSaved,
		publishRecrawlLinkInitiated,
		publishSaveAnonymousLink,
		publishStaleCheckRequested,
		publishSaveLinkRawHtmlCommand,
		publishUpdateFetchTimestamp,
		publishExportUserDataCommand,
		publishCancelSubscriptionCommand,
		publishSubscriptionReactivated,
		putPendingHtml,
		findGeneratedSummary: summaryStore.findGeneratedSummary,
		markSummaryPending: summaryStore.markSummaryPending,
		findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
		markCrawlPending: crawlStore.markCrawlPending,
		forceMarkCrawlPending: crawlStore.forceMarkCrawlPending,
		refreshArticleIfStale,
	};
}

function parseAdminEmails(raw: string): readonly string[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function createHutchApp(deps?: {
	appOrigin?: string;
}) {
	const { auth, articleStore, oauthModel, validateAccessToken, importSessionStore, ...providers } = initProviders();

	const appOrigin = deps?.appOrigin ?? requireEnv("APP_ORIGIN", { defaultValue: `http://localhost:${getEnv("PORT") || "3000"}` });
	const staticBaseUrl = requireEnv("STATIC_BASE_URL");
	const expiryCountdown = requireEnv<"enabled" | "disabled">("EXPIRY_COUNTDOWN");
	const foundingMemberLimit = Number.parseInt(requireEnv("FOUNDING_MEMBER_LIMIT"), 10);
	assert(
		Number.isInteger(foundingMemberLimit) && foundingMemberLimit > 0,
		"FOUNDING_MEMBER_LIMIT must be a positive integer",
	);
	const adminEmails = parseAdminEmails(requireEnv("ADMIN_EMAILS"));
	const recrawlServiceToken = requireEnv("RECRAWL_SERVICE_TOKEN");
	const salt = requireEnv("ANALYTICS_SALT");
	const analyticsLogger = HutchLogger.fromJSON<AnalyticsEvent>();

	const { logParseError } = initLogParseError({
		logger: HutchLogger.fromJSON<ParseErrorEvent>(),
		now: () => new Date(),
		source: "hutch-handler",
	});

	const app = createApp({
		validateSaveableUrl,
		appOrigin,
		staticBaseUrl,
		hashPassword,
		...auth,
		...articleStore,
		...providers,
		adminEmails,
		recrawlServiceToken,
		baseUrl: appOrigin,
		logError: (message, error) => console.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack })),
		oauthModel,
		validateAccessToken,
		httpErrorMessageMapping,
		logParseError,
		importSessionStore,
		now: () => new Date(),
		botDefenseLogger: HutchLogger.fromJSON<BotDefenseEvent>(),
		conversionLogger: HutchLogger.fromJSON<ConversionEvent>(),
		analytics: analyticsLogger,
		salt,
		foundingAllocation: initFoundingAllocation({ foundingMemberLimit }),
		expiryCountdown,
	});

	return { app, auth, articleStore, oauthModel, analyticsLogger };
}

export const localServer = (expressApp: Express, logger: Logger): void => {
	const port = getEnv("PORT") || "3000";
	expressApp.listen(Number.parseInt(port, 10), () => {
		logger.info(`Local server running on http://localhost:${port}`);
	});
};
/* c8 ignore stop */
