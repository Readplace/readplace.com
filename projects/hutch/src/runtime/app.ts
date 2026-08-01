/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { randomInt } from "node:crypto";
import type { Express } from "express";
import { blockedCauseForStatus } from "@packages/article-state-types";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import type { Logger } from "./domain/logger";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initInMemoryIosOnboardingSignal } from "@packages/test-fixtures/providers/ios-onboarding-signal";
import { initInMemoryReadingPreference } from "@packages/test-fixtures/providers/reading-preference";
import { initIosOnboardingSignal } from "./providers/ios-onboarding-signal/dynamodb-ios-onboarding-signal";
import { initReadingPreference } from "./providers/reading-preference/dynamodb-reading-preference";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initDynamoDbSavedArticleStore } from "@packages/article-store";
import type { ExtractPdf } from "@packages/crawl-article";
import {
	CRAWL_PERSONAS,
	initCrawlArticle,
	initFetchPinnedCrawl,
	initCrawlFetch,
	initFetchThumbnailImage,
	initXTwitterSiteRules,
	initAppleNewsSiteRules,
} from "@packages/crawl-article";
import { initExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { initReadabilityParser, linkedinSiteRules, mediaWikiSiteRules, mediumSiteRules, theInformationSiteRules } from "@packages/article-parser";
import { initRefreshArticleIfStale } from "@packages/finalize-article";
import { initSubmitFreshness } from "@packages/save-article";
import {
	createOAuthModel,
	createRevokeAllUserOAuthTokens,
	initInMemoryOAuthClients,
	initInMemoryOAuthModel,
} from "@packages/test-fixtures/providers/oauth";
import { initDynamoDbOAuthModel } from "./providers/oauth/dynamodb-oauth-model";
import { initDynamoDbOAuthClients } from "./providers/oauth/dynamodb-oauth-clients";
import { initOAuthClientLookup } from "@packages/domain/oauth";
import { createValidateAccessToken } from "@packages/web-session";
import { initLogEmail } from "./providers/email/log-email";
import { initResendEmail } from "./providers/email/resend-email";
import { initSkipReservedDomain } from "./providers/email/skip-reserved-domain";
import { initInMemoryEmailVerification } from "@packages/test-fixtures/providers/email-verification";
import { initDynamoDbEmailVerification } from "./providers/email-verification/dynamodb-email-verification";
import { initInMemoryPasswordReset } from "@packages/test-fixtures/providers/password-reset";
import { initDynamoDbPasswordReset } from "./providers/password-reset/dynamodb-password-reset";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import { initDynamoDbRateLimit } from "./providers/rate-limit/dynamodb-rate-limit";
import { initDynamoDbGeneratedSummary } from "@packages/article-store";
import { devSummariseInline } from "./providers/article-summary/dev-summarise-inline";
import { initDynamoDbArticleCrawl } from "@packages/article-store";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { batchFromSingular } from "./batch-from-singular";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { initS3ReadContent } from "@packages/article-store";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initStripePaymentMethods } from "./providers/stripe-payment-methods/stripe-payment-methods";
import { initInMemoryPaymentMethods } from "@packages/test-fixtures/providers/payment-methods";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initInMemorySubscriptionBilling } from "@packages/test-fixtures/providers/subscription-billing";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { initReadArticleContent } from "@packages/article-store";
import { initCanonicalAliasStore, initResolveCanonicalIdentity } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initEventBridgeLinkQueued } from "./providers/events/eventbridge-link-queued";
import { initEventBridgeLinkSaved } from "./providers/events/eventbridge-link-saved";
import { initEventBridgeRecrawlLinkInitiated } from "./providers/events/eventbridge-recrawl-link-initiated";
import { initEventBridgeRemoveMyContent } from "./providers/events/eventbridge-remove-my-content";
import { initEventBridgeSaveAnonymousLink } from "./providers/events/eventbridge-save-anonymous-link";
import { initEventBridgeStaleCheckRequested } from "./providers/events/eventbridge-stale-check-requested";
import { initEventBridgeSaveLinkRawHtmlCommand } from "./providers/events/eventbridge-save-link-raw-html-command";
import { initEventBridgeSaveLinkRawPdfCommand } from "./providers/events/eventbridge-save-link-raw-pdf-command";
import { initEventBridgeUpdateFetchTimestamp } from "./providers/events/eventbridge-update-fetch-timestamp";
import { initEventBridgeExportUserDataCommand } from "./providers/events/eventbridge-export-user-data-command";
import { initEventBridgeDeleteAccountCommand } from "./providers/events/eventbridge-delete-account-command";
import { initEventBridgeCancelSubscriptionCommand } from "./providers/events/eventbridge-cancel-subscription-command";
import { initEventBridgeSubscriptionReactivated } from "./providers/events/eventbridge-subscription-reactivated";
import {
	initInMemoryCancelSubscriptionCommand,
	initInMemoryDeleteAccountCommand,
	initInMemoryExportUserDataCommand,
	initInMemorySubscriptionReactivated,
} from "@packages/test-fixtures/providers/events";
import { initInMemoryLinkQueued, initInMemoryLinkSaved } from "@packages/test-fixtures/providers/events";
import { initInMemoryRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveAnonymousLink } from "@packages/test-fixtures/providers/events";
import { initInMemoryStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveLinkRawPdfCommand } from "@packages/test-fixtures/providers/events";
import { initInMemoryRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import { initInMemoryRemoveMyContent } from "@packages/test-fixtures/providers/events";
import { initInMemoryUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { initPutPendingHtml } from "./providers/pending-html/put-pending-html";
import { initPutPendingPdf } from "./providers/pending-pdf/put-pending-pdf";
import { initS3PendingUpload } from "./providers/pending-upload/s3-pending-upload";
import { createPresignerClient } from "./providers/pending-upload/mint-upload-url";
import { UPLOAD_SLOT_TTL_SECONDS } from "./web/pages/queue/upload-slot-ttl";
import { initInMemoryPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import { initInMemoryPendingPdf } from "@packages/test-fixtures/providers/pending-pdf";
import { initInMemoryPendingUpload } from "@packages/test-fixtures/providers/pending-upload";
import { initInMemoryImportSession } from "@packages/test-fixtures/providers/import-session";
import { initDynamoDbImportSession } from "./providers/import-session/dynamodb-import-session";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initExchangeGoogleCode } from "./providers/google-auth/google-token";
import { initExchangeAppleCode } from "./providers/apple-auth/apple-token";
import { initCreateAppleClientSecret } from "./providers/apple-auth/apple-client-secret";
import { deriveStateSigningSecret } from "./providers/apple-auth/apple-state-secret";
import { initInMemoryHostedCheckout } from "@packages/test-fixtures/providers/hosted-checkout";
import { initStripeCheckout } from "./providers/stripe-checkout/stripe-checkout";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { initDynamoDbPendingSignup } from "./providers/pending-signup/dynamodb-pending-signup";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDynamoDbSubscriptionWrites } from "./providers/subscription-providers/dynamodb-subscription-writes";
import { HutchLogger, consoleLogger, formatErrorLogLine } from "@packages/hutch-logger";
import { isBlockedIpAddress, validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "./server";
import { initChangelogBannerSource } from "./web/changelog-banner-source";
import { readplaceUnwrapPreprocessor } from "./web/pages/view/readplace-unwrap-preprocessor";
import { unwrappedPreProcessors, withUnwrapPreprocessing } from "./web/unwrap-preprocessors";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { SubscriptionLogEvent } from "./observability/subscription-events";
import type { AnalyticsEvent } from "@packages/web-analytics";
import { httpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initCachedUserCount } from "./web/auth/cached-user-count";
import { getEnv, requireEnv } from "@packages/require-env";
import { initDynamoDbInboxAddress } from "@packages/inbox-store";
import { DEFAULT_INBOX_ALIAS } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";

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

/** `appOrigin` is threaded in rather than read from the environment because the
 * dev server may have bound a different port than `APP_ORIGIN` names, and every
 * absolute URL handed to a client has to point back at this process. */
function initProviders(input: { appOrigin: string }) {
	const persistence = requireEnv<"prod" | "development">("PERSISTENCE");
	assert(
		persistence === "prod" || persistence === "development",
		`PERSISTENCE must be "prod" or "development", got "${persistence}"`,
	);
	const logger = HutchLogger.from(consoleLogger);
	const logError = (message: string, error?: Error) => logger.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack }));
	const logInfo = (message: string) => logger.info(JSON.stringify({ level: "INFO", timestamp: new Date().toISOString(), message }));

	const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, personas: CRAWL_PERSONAS, isBlocked: isBlockedIpAddress });
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
		const appleClientId = requireEnv("APPLE_LOGIN_CLIENT_ID");
		const appleTeamId = requireEnv("APPLE_LOGIN_TEAM_ID");
		const appleKeyId = requireEnv("APPLE_LOGIN_KEY_ID");
		const applePrivateKeyPem = Buffer.from(requireEnv("APPLE_LOGIN_PRIVATE_KEY_BASE64"), "base64").toString("utf8");
		assert(applePrivateKeyPem.includes("BEGIN PRIVATE KEY"), "APPLE_LOGIN_PRIVATE_KEY_BASE64 must decode to a PKCS#8 PEM");
		const appOriginForRedirect = input.appOrigin;
		const resendApiKey = requireEnv("RESEND_API_KEY");
		const stripeApiKey = requireEnv("STRIPE_SECRET_KEY");
		const stripePriceId = requireEnv("STRIPE_PRICE_ID");
		const stripePublishableKey = requireEnv("STRIPE_PUBLISHABLE_KEY");
		const eventBusName = requireEnv("EVENT_BUS_NAME");
		const contentBucketName = requireEnv("CONTENT_BUCKET_NAME");
		const pendingHtmlBucketName = requireEnv("PENDING_HTML_BUCKET_NAME");
		const pendingPdfBucketName = requireEnv("PENDING_PDF_BUCKET_NAME");
		const importSessionsTable = requireEnv("DYNAMODB_IMPORT_SESSIONS_TABLE");
		const inboxAddressesTable = requireEnv("DYNAMODB_INBOX_ADDRESSES_TABLE");
		const inboxAddressDomain = requireEnv("INBOX_ADDRESS_DOMAIN");
		const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
		const onboardingTable = requireEnv("DYNAMODB_ONBOARDING_TABLE");
		const readingPreferencesTable = requireEnv("DYNAMODB_READING_PREFERENCES_TABLE");
		const rateLimitsTable = requireEnv("DYNAMODB_RATE_LIMITS_TABLE");
		const trialSchedulerGroupName = requireEnv("TRIAL_SCHEDULER_GROUP_NAME");
		const trialSchedulerRoleArn = requireEnv("TRIAL_SCHEDULER_ROLE_ARN");
		const eventBusArn = requireEnv("EVENT_BUS_ARN");
		const client = createDynamoDocumentClient();
		const s3Client = new S3Client({});
		const schedulerClient = new SchedulerClient({});

		const auth = initDynamoDbAuth({ client, usersTableName: usersTable, sessionsTableName: sessionsTable });
		const iosOnboardingSignal = initIosOnboardingSignal({ client, onboardingTableName: onboardingTable, now: () => new Date() });
		const readingPreference = initReadingPreference({ client, tableName: readingPreferencesTable });
		const articleStore = initDynamoDbSavedArticleStore({ client, tableName: articlesTable, userArticlesTableName: userArticlesTable, logger });
		const canonicalAlias = initCanonicalAliasStore({ client, tableName: articlesTable });
		const resolveCanonicalIdentity = initResolveCanonicalIdentity({ resolveAlias: canonicalAlias.resolveAlias });
		const readArticleContent = initReadArticleContent({
			storageProviderQueryOrder: [
				initS3ReadContent({ send: (cmd) => s3Client.send(cmd), bucketName: contentBucketName }),
				articleStore.readContent, // Legacy fallback for articles saved before S3 migration
			],
			logError,
		});
		const oauthClients = initDynamoDbOAuthClients({ client, tableName: oauthTable, now: () => new Date() });
		const oauthClientLookup = initOAuthClientLookup({ dynamic: oauthClients });
		const oauthModel = initDynamoDbOAuthModel({
			client,
			tableName: oauthTable,
			findUserById: auth.findUserById,
			findClient: oauthClientLookup.findClient,
			markClientActive: oauthClientLookup.markClientActive,
		});
		const summaryStore = initDynamoDbGeneratedSummary({ client, tableName: articlesTable });
		const crawlStore = initDynamoDbArticleCrawl({
			client,
			tableName: articlesTable,
			now: () => new Date(),
		});
		const { publishEvent } = initEventBridgePublisher({
			client: new EventBridgeClient({}),
			eventBusName,
		});
		const { publishLinkSaved } = initEventBridgeLinkSaved({ publishEvent });
		const { publishLinkQueued } = initEventBridgeLinkQueued({ publishEvent });
		const { publishRecrawlLinkInitiated } = initEventBridgeRecrawlLinkInitiated({ publishEvent });
		const { publishRemoveMyContent } = initEventBridgeRemoveMyContent({ publishEvent });
		const { publishSaveAnonymousLink } = initEventBridgeSaveAnonymousLink({ publishEvent });
		const { publishStaleCheckRequested } = initEventBridgeStaleCheckRequested({ publishEvent });
		const { publishSaveLinkRawHtmlCommand } = initEventBridgeSaveLinkRawHtmlCommand({ publishEvent });
		const { publishSaveLinkRawPdfCommand } = initEventBridgeSaveLinkRawPdfCommand({ publishEvent });
		const { publishUpdateFetchTimestamp } = initEventBridgeUpdateFetchTimestamp({ publishEvent });
		const { publishExportUserDataCommand } = initEventBridgeExportUserDataCommand({ publishEvent });
		const { publishDeleteAccountCommand } = initEventBridgeDeleteAccountCommand({ publishEvent });
		const { publishCancelSubscriptionCommand } = initEventBridgeCancelSubscriptionCommand({ publishEvent });
		const { publishSubscriptionReactivated } = initEventBridgeSubscriptionReactivated({ publishEvent });
		const { putPendingHtml } = initPutPendingHtml({ client: new S3Client({}), bucketName: pendingHtmlBucketName });
		const { putPendingPdf } = initPutPendingPdf({ client: new S3Client({}), bucketName: pendingPdfBucketName });
		const { createUploadSlot, statPendingUpload, readPendingUploadPrefix } = initS3PendingUpload({
			presignerClient: createPresignerClient(),
			client: new S3Client({}),
			pdfBucketName: pendingPdfBucketName,
			htmlBucketName: pendingHtmlBucketName,
			ttlSeconds: UPLOAD_SLOT_TTL_SECONDS,
			now: () => new Date(),
		});
		const extractLinksFromPageUrl = initExtractLinksFromPageUrl({ crawlFetch, validateUrl: validateSaveableUrl });
		const { refreshArticleIfStale } = initSubmitFreshness({
			findArticleByUrl: articleStore.findArticleByUrl,
			findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
			resolveCanonicalIdentity,
			publishStaleCheckRequested,
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
		const appleAuth = {
			exchangeAppleCode: initExchangeAppleCode({
				clientId: appleClientId,
				createClientSecret: initCreateAppleClientSecret({
					teamId: appleTeamId,
					clientId: appleClientId,
					keyId: appleKeyId,
					privateKeyPem: applePrivateKeyPem,
					now: () => new Date(),
				}),
				redirectUri: `${appOriginForRedirect}/auth/apple/callback`,
				fetch: globalThis.fetch,
			}),
			clientId: appleClientId,
			stateSigningSecret: deriveStateSigningSecret(applePrivateKeyPem),
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
		const paymentMethods = initStripePaymentMethods({
			apiKey: stripeApiKey,
			fetch: globalThis.fetch,
			logger,
		});
		const pendingSignup = initDynamoDbPendingSignup({ client, tableName: pendingSignupsTable, logger: consoleLogger });
		const subscriptionProviders = {
			...initDynamoDbSubscriptionRead({ client, tableName: subscriptionProvidersTable }),
			...initDynamoDbSubscriptionWrites({
				client,
				tableName: subscriptionProvidersTable,
				now: () => new Date(),
			}),
		};
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
		const inboxAddressStore = initDynamoDbInboxAddress({
			client,
			tableName: inboxAddressesTable,
			now: () => new Date(),
		});
		const { consumeRateLimit } = initDynamoDbRateLimit({
			client,
			tableName: rateLimitsTable,
			now: () => new Date(),
		});
		// Strict (no defaults) so a deploy missing a limit fails at cold start
		// instead of silently running unthrottled. Values come from the Pulumi
		// stack config via the Lambda environment.
		const rateLimitRules: RateLimitRules = {
			viewCrawl: parseRateLimitRule(requireEnv("RATE_LIMIT_VIEW_CRAWL")),
			login: parseRateLimitRule(requireEnv("RATE_LIMIT_LOGIN")),
			loginAccount: parseRateLimitRule(requireEnv("RATE_LIMIT_LOGIN_ACCOUNT")),
			signup: parseRateLimitRule(requireEnv("RATE_LIMIT_SIGNUP")),
			forgotPassword: parseRateLimitRule(requireEnv("RATE_LIMIT_FORGOT_PASSWORD")),
			oauthRegister: parseRateLimitRule(requireEnv("RATE_LIMIT_OAUTH_REGISTER")),
			oauthToken: parseRateLimitRule(requireEnv("RATE_LIMIT_OAUTH_TOKEN")),
			import: parseRateLimitRule(requireEnv("RATE_LIMIT_IMPORT")),
			importFromUrl: parseRateLimitRule(requireEnv("RATE_LIMIT_IMPORT_FROM_URL")),
		};

		return {
			auth,
			articleStore,
			readArticleContent,
			importSessionStore,
			extractLinksFromPageUrl,
			provisionInboxAddress: async (userId: UserId) => {
				await inboxAddressStore.createAddress({
					userId,
					domain: inboxAddressDomain,
					name: DEFAULT_INBOX_ALIAS,
				});
			},
			subscriptionProviders,
			trialScheduler,
			createSubscriptionOnExistingCustomer: stripeSubscriptions.createSubscriptionOnExistingCustomer,
			findSubscriptionNextCharge: stripeSubscriptions.findSubscriptionNextCharge,
			reverseScheduledCancellation: stripeSubscriptions.reverseScheduledCancellation,
			paymentMethods,
			stripePriceId,
			stripePublishableKey,

			...initSkipReservedDomain({
				...initResendEmail(resendApiKey),
				logger,
			}),
			...initDynamoDbEmailVerification({ client, tableName: verificationTokensTable }),
			...initDynamoDbPasswordReset({ client, tableName: passwordResetTokensTable }),
			...stripe,
			...pendingSignup,
			googleAuth,
			appleAuth,
			oauthModel,
			revokeAllUserOAuthTokens: oauthModel.revokeAllUserOAuthTokens,
			validateAccessToken: createValidateAccessToken(oauthModel),
			findOAuthClient: oauthClientLookup.findClient,
			validateOAuthRedirectUri: oauthClientLookup.validateRedirectUri,
			registerOAuthClient: oauthClients.registerClient,
			publishLinkSaved,
			publishLinkQueued,
			publishRecrawlLinkInitiated,
			publishRemoveMyContent,
			publishSaveAnonymousLink,
			publishStaleCheckRequested,
			publishSaveLinkRawHtmlCommand,
			publishSaveLinkRawPdfCommand,
			publishUpdateFetchTimestamp,
			publishExportUserDataCommand,
			publishDeleteAccountCommand,
			publishCancelSubscriptionCommand,
			publishSubscriptionReactivated,
			putPendingHtml,
			putPendingPdf,
			createUploadSlot,
			statPendingUpload,
			readPendingUploadPrefix,
			findGeneratedSummary: summaryStore.findGeneratedSummary,
			findGeneratedSummaries: summaryStore.findGeneratedSummaries,
			markSummaryPending: summaryStore.markSummaryPending,
			findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
			findArticleCrawlStatuses: crawlStore.findArticleCrawlStatuses,
			findArticleFreshness: articleStore.findArticleFreshness,
			findArticleCrawlVersions: articleStore.findArticleCrawlVersions,
			markCrawlPending: crawlStore.markCrawlPending,
			forceMarkCrawlPending: crawlStore.forceMarkCrawlPending,
			refreshArticleIfStale,
			resolveCanonicalIdentity,
			getIosAppSignals: iosOnboardingSignal.getIosAppSignals,
			recordIosAnyActivity: iosOnboardingSignal.recordIosAnyActivity,
			recordIosSavedArticle: iosOnboardingSignal.recordIosSavedArticle,
			saveReadingPreference: readingPreference.saveReadingPreference,
			getReadingPreference: readingPreference.getReadingPreference,
			consumeRateLimit,
			rateLimitRules,
		};
	}

	const auth = initInMemoryAuth({ hashPassword, verifyPassword });
	const iosOnboardingSignal = initInMemoryIosOnboardingSignal();
	const readingPreference = initInMemoryReadingPreference();
	const articleStore = initInMemoryArticleStore();
	const oauthClients = initInMemoryOAuthClients({ now: () => new Date() });
	const oauthClientLookup = initOAuthClientLookup({ dynamic: oauthClients });
	const oauthModelDeps = initInMemoryOAuthModel();
	const oauthModel = createOAuthModel(oauthModelDeps, {
		findUserById: auth.findUserById,
		findClient: oauthClientLookup.findClient,
		markClientActive: oauthClientLookup.markClientActive,
	});
	const revokeAllUserOAuthTokens = createRevokeAllUserOAuthTokens(oauthModelDeps);
	const devStripe = initInMemoryHostedCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() });
	const devStripeSubscriptions = initInMemorySubscriptionBilling();
	const devPendingSignup = initInMemoryPendingSignup();
	const devSubscriptionProviders = initInMemorySubscriptionProviders({ now: () => new Date() });
	const devPaymentMethods = initInMemoryPaymentMethods();
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
	const devAppleClientId = getEnv("APPLE_LOGIN_CLIENT_ID");
	const devAppleTeamId = getEnv("APPLE_LOGIN_TEAM_ID");
	const devAppleKeyId = getEnv("APPLE_LOGIN_KEY_ID");
	const devApplePrivateKeyBase64 = getEnv("APPLE_LOGIN_PRIVATE_KEY_BASE64");
	assert(
		(devAppleClientId && devAppleTeamId && devAppleKeyId && devApplePrivateKeyBase64) ||
			(!devAppleClientId && !devAppleTeamId && !devAppleKeyId && !devApplePrivateKeyBase64),
		"APPLE_LOGIN_CLIENT_ID, APPLE_LOGIN_TEAM_ID, APPLE_LOGIN_KEY_ID and APPLE_LOGIN_PRIVATE_KEY_BASE64 must all be set or all unset",
	);
	const devApplePrivateKeyPem = devApplePrivateKeyBase64
		? Buffer.from(devApplePrivateKeyBase64, "base64").toString("utf8")
		: undefined;
	const appleAuth =
		devAppleClientId && devAppleTeamId && devAppleKeyId && devApplePrivateKeyPem
			? {
				exchangeAppleCode: initExchangeAppleCode({
					clientId: devAppleClientId,
					createClientSecret: initCreateAppleClientSecret({
						teamId: devAppleTeamId,
						clientId: devAppleClientId,
						keyId: devAppleKeyId,
						privateKeyPem: devApplePrivateKeyPem,
						now: () => new Date(),
					}),
					redirectUri: `http://localhost:${getEnv("PORT") || "3000"}/auth/apple/callback`,
					fetch: globalThis.fetch,
				}),
				clientId: devAppleClientId,
				stateSigningSecret: deriveStateSigningSecret(devApplePrivateKeyPem),
			}
			: {
				// appleAuth is mandatory (the /auth/apple route always mounts), but local
				// dev has no Apple key and can't complete Apple's handshake from localhost,
				// so the exchange is stubbed; the button still redirects to Apple.
				exchangeAppleCode: async () => {
					throw new Error("Apple sign-in is not configured for local development");
				},
				clientId: "dev.readplace.apple-login",
				stateSigningSecret: "dev-apple-state-signing-secret",
			};
	const crawlStore = initInMemoryArticleCrawl();
	const summaryStore = initInMemoryGeneratedSummary();
	const { publishStaleCheckRequested } = initInMemoryStaleCheckRequested({ logger: consoleLogger });
	const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
	const siteRules = [
		theInformationSiteRules,
		mediumSiteRules,
		linkedinSiteRules,
		mediaWikiSiteRules,
		initXTwitterSiteRules({ crawlFetch, logError }),
		initAppleNewsSiteRules({ crawlFetch, logError }),
	];
	const crawlArticle = initFetchPinnedCrawl({
		crawlArticle: initCrawlArticle({ crawlFetch, siteRules, extractPdf, logError, logInfo }),
		findAdoptedFetchUrl: async () => undefined,
	});
	const extractLinksFromPageUrl = initExtractLinksFromPageUrl({ crawlFetch, validateUrl: validateSaveableUrl });
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		siteRules,
		logError,
	});
	const fetchThumbnailImage = initFetchThumbnailImage({ crawlFetch, logError, logInfo });
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
	const finaliseSummaryFromContent = async (params: { url: string; html: string }) => {
		await summaryStore.markSummaryPending({ url: params.url });
		const summary = devSummariseInline({ html: params.html });
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
		if (result.status === "not-found") {
			await crawlStore.markCrawlFailed({ url, reason: `not-found: HTTP ${result.httpStatus}` });
			return;
		}
		if (result.status === "blocked") {
			await crawlStore.markCrawlFailed({
				url,
				reason: JSON.stringify({
					kind: "blocked",
					cause: blockedCauseForStatus(result.httpStatus),
				}),
			});
			return;
		}
		if (result.status === "not-modified") return;
		await articleStore.writeContent({ url, content: result.article.html });
		// Prod records the crawl instant via the RefreshArticleContent Lambda; dev's
		// inline crawl must stamp it too, otherwise contentFetchedAt stays unset and
		// the "Last crawled at" bookmark never renders locally.
		await articleStore.setContentFetchedAt({ url, at: new Date().toISOString() });
		await crawlStore.markCrawlReady({ url });
		await finaliseSummaryFromContent({ url, html: result.article.html });
	};
	const { publishLinkQueued } = initInMemoryLinkQueued({ logger: consoleLogger });
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
	const { publishRemoveMyContent } = initInMemoryRemoveMyContent({ logger: consoleLogger });
	const { publishUpdateFetchTimestamp } = initInMemoryUpdateFetchTimestamp({ logger: consoleLogger });
	const { publishSaveLinkRawHtmlCommand } = initInMemorySaveLinkRawHtmlCommand({ logger: consoleLogger });
	const { publishSaveLinkRawPdfCommand } = initInMemorySaveLinkRawPdfCommand({ logger: consoleLogger });
	const { publishExportUserDataCommand } = initInMemoryExportUserDataCommand({ logger: consoleLogger });
	const { publishDeleteAccountCommand } = initInMemoryDeleteAccountCommand({ logger: consoleLogger });
	const { publishCancelSubscriptionCommand } = initInMemoryCancelSubscriptionCommand({ logger: consoleLogger });
	const { publishSubscriptionReactivated } = initInMemorySubscriptionReactivated({ logger: consoleLogger });
	const { putPendingHtml } = initInMemoryPendingHtml();
	const { putPendingPdf } = initInMemoryPendingPdf();
	/* The in-memory composition has no alias store, so identity resolution is a
	 * no-op — dedup-by-redirect is a production DynamoDB behaviour only. */
	const resolveCanonicalIdentity = async (url: string) => url;
	const { createUploadSlot, statPendingUpload, readPendingUploadPrefix } = initInMemoryPendingUpload({
		uploadBaseUrl: `${input.appOrigin}/e2e/s3`,
		now: () => new Date(),
		ttlSeconds: UPLOAD_SLOT_TTL_SECONDS,
	});
	const { refreshArticleIfStale } = initRefreshArticleIfStale({
		findArticleFreshness: articleStore.findArticleFreshness,
		findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
		crawlArticle,
		parseHtml,
		publishRefreshArticleContent,
		publishUpdateFetchTimestamp,
		resolveCanonicalIdentity,
		now: () => new Date(),
		staleTtlMs,
	});

	const importSessionStore = initInMemoryImportSession({ now: () => new Date() });
	const inboxAddressStore = initInMemoryInboxAddress({ now: () => new Date() });
	const inboxAddressDomain = requireEnv("INBOX_ADDRESS_DOMAIN");

	// In-process counters are valid here because dev runs a single long-lived
	// server. Defaults are liberal — every local/e2e request shares 127.0.0.1,
	// so prod-strength per-IP limits would throttle a full e2e run.
	const { consumeRateLimit } = initInMemoryRateLimit({ now: () => new Date() });
	const rateLimitRules: RateLimitRules = {
		viewCrawl: parseRateLimitRule(requireEnv("RATE_LIMIT_VIEW_CRAWL")),
		login: parseRateLimitRule(requireEnv("RATE_LIMIT_LOGIN")),
		loginAccount: parseRateLimitRule(requireEnv("RATE_LIMIT_LOGIN_ACCOUNT")),
		signup: parseRateLimitRule(requireEnv("RATE_LIMIT_SIGNUP")),
		forgotPassword: parseRateLimitRule(requireEnv("RATE_LIMIT_FORGOT_PASSWORD")),
		oauthRegister: parseRateLimitRule(requireEnv("RATE_LIMIT_OAUTH_REGISTER")),
		oauthToken: parseRateLimitRule(requireEnv("RATE_LIMIT_OAUTH_TOKEN")),
		import: parseRateLimitRule(requireEnv("RATE_LIMIT_IMPORT")),
		importFromUrl: parseRateLimitRule(requireEnv("RATE_LIMIT_IMPORT_FROM_URL")),
	};

	return {
		auth,
		articleStore,
		readArticleContent: initReadArticleContent({
			storageProviderQueryOrder: [articleStore.readContent],
			logError,
		}),
		importSessionStore,
		extractLinksFromPageUrl,
		provisionInboxAddress: async (userId: UserId) => {
			await inboxAddressStore.createAddress({
				userId,
				domain: inboxAddressDomain,
				name: DEFAULT_INBOX_ALIAS,
			});
		},
		subscriptionProviders: devSubscriptionProviders,
		trialScheduler: devTrialScheduler,
		createSubscriptionOnExistingCustomer: devStripeSubscriptions.createSubscriptionOnExistingCustomer,
		findSubscriptionNextCharge: devStripeSubscriptions.findSubscriptionNextCharge,
		reverseScheduledCancellation: devStripeSubscriptions.reverseScheduledCancellation,
		paymentMethods: devPaymentMethods,
		stripePriceId: "price_dev_default",
		stripePublishableKey: getEnv("STRIPE_PUBLISHABLE_KEY"),

		...initLogEmail({ logger: HutchLogger.from(consoleLogger) }),
		...initInMemoryEmailVerification(),
		...initInMemoryPasswordReset(),
		createCheckoutSession: devStripe.createCheckoutSession,
		retrieveCheckoutSession: devStripe.retrieveCheckoutSession,
		storePendingSignup: devPendingSignup.storePendingSignup,
		consumePendingSignup: devPendingSignup.consumePendingSignup,
		googleAuth,
		appleAuth,
		oauthModel,
		revokeAllUserOAuthTokens,
		validateAccessToken: createValidateAccessToken(oauthModel),
		findOAuthClient: oauthClientLookup.findClient,
		validateOAuthRedirectUri: oauthClientLookup.validateRedirectUri,
		registerOAuthClient: oauthClients.registerClient,
		publishLinkSaved,
		publishLinkQueued,
		publishRecrawlLinkInitiated,
		publishRemoveMyContent,
		publishSaveAnonymousLink,
		publishStaleCheckRequested,
		publishSaveLinkRawHtmlCommand,
		publishSaveLinkRawPdfCommand,
		publishUpdateFetchTimestamp,
		publishExportUserDataCommand,
		publishDeleteAccountCommand,
		publishCancelSubscriptionCommand,
		publishSubscriptionReactivated,
		putPendingHtml,
		putPendingPdf,
		createUploadSlot,
		statPendingUpload,
		readPendingUploadPrefix,
		findGeneratedSummary: summaryStore.findGeneratedSummary,
		findGeneratedSummaries: batchFromSingular(summaryStore.findGeneratedSummary),
		markSummaryPending: summaryStore.markSummaryPending,
		findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
		findArticleCrawlStatuses: batchFromSingular(crawlStore.findArticleCrawlStatus),
		findArticleFreshness: articleStore.findArticleFreshness,
		findArticleCrawlVersions: articleStore.findArticleCrawlVersions,
		markCrawlPending: crawlStore.markCrawlPending,
		forceMarkCrawlPending: crawlStore.forceMarkCrawlPending,
		refreshArticleIfStale,
		resolveCanonicalIdentity,
		getIosAppSignals: iosOnboardingSignal.getIosAppSignals,
		recordIosAnyActivity: iosOnboardingSignal.recordIosAnyActivity,
		recordIosSavedArticle: iosOnboardingSignal.recordIosSavedArticle,
		saveReadingPreference: readingPreference.saveReadingPreference,
		getReadingPreference: readingPreference.getReadingPreference,
		consumeRateLimit,
		rateLimitRules,
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
	const appOrigin = deps?.appOrigin ?? requireEnv("APP_ORIGIN");
	const { auth, articleStore, oauthModel, validateAccessToken, importSessionStore, ...providers } = initProviders({ appOrigin });
	const staticBaseUrl = requireEnv("STATIC_BASE_URL");
	const foundingMemberLimit = Number.parseInt(requireEnv("FOUNDING_MEMBER_LIMIT"), 10);
	assert(
		Number.isInteger(foundingMemberLimit) && foundingMemberLimit > 0,
		"FOUNDING_MEMBER_LIMIT must be a positive integer",
	);
	const adminEmails = parseAdminEmails(requireEnv("ADMIN_EMAILS"));
	const recrawlServiceToken = requireEnv("RECRAWL_SERVICE_TOKEN");
	const salt = requireEnv("ANALYTICS_SALT");
	const analyticsLogger = HutchLogger.fromJSON<AnalyticsEvent>();

	// Decorative, cached, fail-open source for the site-wide changelog banner.
	// Points at blog-site's fragment endpoint via hutch's own API Gateway (set in
	// infra); a slow or down source never blocks a page render.
	const { getChangelogBanner } = initChangelogBannerSource({
		fetch: globalThis.fetch,
		sourceUrl: requireEnv("CHANGELOG_BANNER_URL"),
		now: () => Date.now(),
		ttlMs: 300_000,
		timeoutMs: 800,
		logger: HutchLogger.from(consoleLogger),
	});

	const app = createApp({
		validateSaveableUrl: withUnwrapPreprocessing(
			validateSaveableUrl,
			unwrappedPreProcessors(readplaceUnwrapPreprocessor),
			{ selfHost: new URL(appOrigin).host },
		),
		appOrigin,
		staticBaseUrl,
		hashPassword,
		...auth,
		...articleStore,
		...providers,
		countUsers: initCachedUserCount({ countUsers: auth.countUsers, now: () => Date.now(), ttlMs: 60_000 }),
		adminEmails,
		recrawlServiceToken,
		baseUrl: appOrigin,
		logError: (message, error) =>
			HutchLogger.from(consoleLogger).error(
				formatErrorLogLine({ message, error, now: () => new Date() }),
			),
		oauthModel,
		validateAccessToken,
		httpErrorMessageMapping,
		importSessionStore,
		getChangelogBanner,
		now: () => new Date(),
		drawRandomByte: () => randomInt(256),
		botDefenseLogger: HutchLogger.fromJSON<BotDefenseEvent>(),
		conversionLogger: HutchLogger.fromJSON<ConversionEvent>(),
		subscriptionLogger: HutchLogger.fromJSON<SubscriptionLogEvent>(),
		analytics: analyticsLogger,
		salt,
		foundingAllocation: initFoundingAllocation({ foundingMemberLimit }),
	});

	return { app, auth, articleStore, oauthModel, analyticsLogger };
}

export const localServer = (expressApp: Express, logger: Logger): void => {
	const port = getEnv("PORT") || "3000";
	expressApp.listen(Number.parseInt(port, 10)).on("listening", () => {
		logger.info(`Local server running on http://localhost:${port}`);
	});
};
/* c8 ignore stop */
