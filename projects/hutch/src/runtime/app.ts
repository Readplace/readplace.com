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
import { DEFAULT_CRAWL_HEADERS, initComprehensiveCrawl, initCrawlArticle, initCrawlFetch, initSimpleCrawl } from "@packages/crawl-article";
import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import { initReadabilityParser } from "@packages/test-fixtures/providers/article-parser";
import { mediumPreParser, theInformationPreParser } from "@packages/test-fixtures/providers/article-parser";
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
import { initDynamoDbGeneratedSummary } from "./providers/article-summary/dynamodb-generated-summary";
import { initDynamoDbArticleCrawl } from "./providers/article-crawl/dynamodb-article-crawl";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { S3Client } from "@aws-sdk/client-s3";
import { initS3ReadContent } from "./providers/article-store/s3-read-content";
import { initReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initEventBridgeLinkSaved } from "./providers/events/eventbridge-link-saved";
import { initEventBridgeRecrawlLinkInitiated } from "./providers/events/eventbridge-recrawl-link-initiated";
import { initEventBridgeSaveAnonymousLink } from "./providers/events/eventbridge-save-anonymous-link";
import { initEventBridgeStaleCheckRequested } from "./providers/events/eventbridge-stale-check-requested";
import { initEventBridgeSaveLinkRawHtmlCommand } from "./providers/events/eventbridge-save-link-raw-html-command";
import { initEventBridgeRefreshArticleContent } from "./providers/events/eventbridge-refresh-article-content";
import { initEventBridgeUpdateFetchTimestamp } from "./providers/events/eventbridge-update-fetch-timestamp";
import { initEventBridgeExportUserDataCommand } from "./providers/events/eventbridge-export-user-data-command";
import { initInMemoryExportUserDataCommand } from "@packages/test-fixtures/providers/events";
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
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initLogParseError, type ParseErrorEvent } from "@packages/hutch-infra-components";
import { validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "./server";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { AnalyticsEvent } from "./web/middleware/analytics";
import { httpErrorMessageMapping } from "./web/pages/queue/queue.error";
import {
	PROD_FOUNDING_MEMBER_LIMIT,
	initFoundingAllocation,
} from "./web/shared/founding-progress/founding-allocation";
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

	const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, defaultHeaders: { ...DEFAULT_CRAWL_HEADERS } });
	const staleTtlMs = 86400000;

	if (persistence === "prod") {
		const articlesTable = requireEnv("DYNAMODB_ARTICLES_TABLE");
		const userArticlesTable = requireEnv("DYNAMODB_USER_ARTICLES_TABLE");
		const usersTable = requireEnv("DYNAMODB_USERS_TABLE");
		const sessionsTable = requireEnv("DYNAMODB_SESSIONS_TABLE");
		const oauthTable = requireEnv("DYNAMODB_OAUTH_TABLE");
		const verificationTokensTable = requireEnv("DYNAMODB_VERIFICATION_TOKENS_TABLE");
		const passwordResetTokensTable = requireEnv("DYNAMODB_PASSWORD_RESET_TOKENS_TABLE");
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
		const client = createDynamoDocumentClient();
		const s3Client = new S3Client({});

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
		const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({ publishEvent });
		const { publishUpdateFetchTimestamp } = initEventBridgeUpdateFetchTimestamp({ publishEvent });
		const { publishExportUserDataCommand } = initEventBridgeExportUserDataCommand({ publishEvent });
		const { putPendingHtml } = initPutPendingHtml({ client: new S3Client({}), bucketName: pendingHtmlBucketName });
		const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
		const simpleCrawl = initSimpleCrawl({ crawlFetch, logError });
		const comprehensiveCrawl = initComprehensiveCrawl({ crawlFetch, extractPdf, logError });
		const crawlArticle = initCrawlArticle({ simpleCrawl, comprehensiveCrawl });
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
		const pendingSignup = initDynamoDbPendingSignup({ client, tableName: pendingSignupsTable });
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

			...initResendEmail(resendApiKey),
			...initDynamoDbEmailVerification({ client, tableName: verificationTokensTable }),
			...initDynamoDbPasswordReset({ client, tableName: passwordResetTokensTable }),
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
	const devPendingSignup = initInMemoryPendingSignup();
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
	const { publishStaleCheckRequested } = initInMemoryStaleCheckRequested({ logger: consoleLogger });
	const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
	const simpleCrawl = initSimpleCrawl({ crawlFetch, logError });
	const comprehensiveCrawl = initComprehensiveCrawl({ crawlFetch, extractPdf, logError });
	const crawlArticle = initCrawlArticle({ simpleCrawl, comprehensiveCrawl });
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		sitePreParsers: [theInformationPreParser, mediumPreParser],
		logError,
	});
	const { publishLinkSaved: logOnlyPublishLinkSaved } = initInMemoryLinkSaved({ logger: consoleLogger });
	const publishLinkSaved: typeof logOnlyPublishLinkSaved = async (params) => {
		await logOnlyPublishLinkSaved(params);
		const crawlResult = await crawlArticle({ url: params.url });
		if (crawlResult.status === "unsupported") {
			await crawlStore.markCrawlUnsupported({ url: params.url, reason: crawlResult.reason });
			return;
		}
		if (crawlResult.status !== "fetched") {
			await crawlStore.markCrawlFailed({ url: params.url, reason: `crawl-${crawlResult.status}` });
			return;
		}
		const result = parseHtml({ url: params.url, html: crawlResult.html });
		if (!result.ok) {
			await crawlStore.markCrawlFailed({ url: params.url, reason: result.reason });
			return;
		}
		await articleStore.writeContent({ url: params.url, content: result.article.content });
		await crawlStore.markCrawlReady({ url: params.url });
	};
	const { publishSaveAnonymousLink: logOnlyPublishSaveAnonymousLink } = initInMemorySaveAnonymousLink({ logger: consoleLogger });
	const publishSaveAnonymousLink: typeof logOnlyPublishSaveAnonymousLink = async (params) => {
		await logOnlyPublishSaveAnonymousLink(params);
		const crawlResult = await crawlArticle({ url: params.url });
		if (crawlResult.status === "unsupported") {
			await crawlStore.markCrawlUnsupported({ url: params.url, reason: crawlResult.reason });
			return;
		}
		if (crawlResult.status !== "fetched") {
			await crawlStore.markCrawlFailed({ url: params.url, reason: `crawl-${crawlResult.status}` });
			return;
		}
		const result = parseHtml({ url: params.url, html: crawlResult.html });
		if (!result.ok) {
			await crawlStore.markCrawlFailed({ url: params.url, reason: result.reason });
			return;
		}
		await articleStore.writeContent({ url: params.url, content: result.article.content });
		await crawlStore.markCrawlReady({ url: params.url });
	};
	const { publishRecrawlLinkInitiated: logOnlyPublishRecrawlLinkInitiated } = initInMemoryRecrawlLinkInitiated({ logger: consoleLogger });
	const publishRecrawlLinkInitiated: typeof logOnlyPublishRecrawlLinkInitiated = async (params) => {
		await logOnlyPublishRecrawlLinkInitiated(params);
		const crawlResult = await crawlArticle({ url: params.url });
		if (crawlResult.status === "unsupported") {
			await crawlStore.markCrawlUnsupported({ url: params.url, reason: crawlResult.reason });
			return;
		}
		if (crawlResult.status !== "fetched") {
			await crawlStore.markCrawlFailed({ url: params.url, reason: `crawl-${crawlResult.status}` });
			return;
		}
		const result = parseHtml({ url: params.url, html: crawlResult.html });
		if (!result.ok) {
			await crawlStore.markCrawlFailed({ url: params.url, reason: result.reason });
			return;
		}
		await articleStore.writeContent({ url: params.url, content: result.article.content });
		await crawlStore.markCrawlReady({ url: params.url });
	};
	const { publishRefreshArticleContent } = initInMemoryRefreshArticleContent({ logger: consoleLogger });
	const { publishUpdateFetchTimestamp } = initInMemoryUpdateFetchTimestamp({ logger: consoleLogger });
	const { publishSaveLinkRawHtmlCommand } = initInMemorySaveLinkRawHtmlCommand({ logger: consoleLogger });
	const { publishExportUserDataCommand } = initInMemoryExportUserDataCommand({ logger: consoleLogger });
	const { putPendingHtml } = initInMemoryPendingHtml();
	const stubFindGeneratedSummary = async (_url: string) => undefined;
	const stubMarkSummaryPending = async (_params: { url: string }) => {};
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

		...initLogEmail(),
		...initInMemoryEmailVerification(),
		...initInMemoryPasswordReset(),
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
		putPendingHtml,
		findGeneratedSummary: stubFindGeneratedSummary,
		markSummaryPending: stubMarkSummaryPending,
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
		foundingAllocation: initFoundingAllocation({
			foundingMemberLimit: PROD_FOUNDING_MEMBER_LIMIT,
		}),
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
