/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import type { Express } from "express";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import type { Logger } from "./domain/logger";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { initDynamoDbAuth } from "./providers/auth/dynamodb-auth";
import { initInMemoryIosOnboardingSignal } from "@packages/test-fixtures/providers/ios-onboarding-signal";
import { initIosOnboardingSignal } from "./providers/ios-onboarding-signal/dynamodb-ios-onboarding-signal";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import { initDynamoDbArticleStore } from "./providers/article-store/dynamodb-article-store";
import type { ExtractPdf } from "@packages/crawl-article";
import {
	CRAWL_PERSONAS,
	initCrawlArticle,
	initCrawlFetch,
	initFetchThumbnailImage,
	initXTwitterSiteRules,
} from "@packages/crawl-article";
import { initExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { initReadabilityParser, linkedinSiteRules, mediumSiteRules, theInformationSiteRules } from "@packages/article-parser";
import { initRefreshArticleIfStale } from "@packages/finalize-article";
import {
	createOAuthModel,
	initInMemoryOAuthClients,
	initInMemoryOAuthModel,
} from "@packages/test-fixtures/providers/oauth";
import { initDynamoDbOAuthModel } from "./providers/oauth/dynamodb-oauth-model";
import { initDynamoDbOAuthClients } from "./providers/oauth/dynamodb-oauth-clients";
import { initOAuthClientLookup } from "@packages/domain/oauth";
import { createValidateAccessToken } from "@packages/web-session";
import { initLogEmail } from "./providers/email/log-email";
import { initResendEmail } from "./providers/email/resend-email";
import { initInMemoryEmailVerification } from "@packages/test-fixtures/providers/email-verification";
import { initDynamoDbEmailVerification } from "./providers/email-verification/dynamodb-email-verification";
import { initInMemoryPasswordReset } from "@packages/test-fixtures/providers/password-reset";
import { initDynamoDbPasswordReset } from "./providers/password-reset/dynamodb-password-reset";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import { initDynamoDbRateLimit } from "./providers/rate-limit/dynamodb-rate-limit";
import { initDynamoDbGeneratedSummary } from "./providers/article-summary/dynamodb-generated-summary";
import { devSummariseInline } from "./providers/article-summary/dev-summarise-inline";
import { initDynamoDbArticleCrawl } from "./providers/article-crawl/dynamodb-article-crawl";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { initS3ReadContent } from "./providers/article-store/s3-read-content";
import { initStripeSubscriptions } from "./providers/stripe-subscriptions/stripe-subscriptions";
import { initStripePaymentMethods } from "./providers/stripe-payment-methods/stripe-payment-methods";
import { initInMemoryPaymentMethods } from "@packages/test-fixtures/providers/payment-methods";
import { initAwsTrialScheduler } from "./providers/trial-scheduler/aws-trial-scheduler";
import { initInMemoryStripeSubscriptions } from "@packages/test-fixtures/providers/stripe-subscriptions";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { initReadArticleContent } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initEventBridgeLinkSaved } from "./providers/events/eventbridge-link-saved";
import { initEventBridgeRecrawlLinkInitiated } from "./providers/events/eventbridge-recrawl-link-initiated";
import { initEventBridgeSaveAnonymousLink } from "./providers/events/eventbridge-save-anonymous-link";
import { initEventBridgeStaleCheckRequested } from "./providers/events/eventbridge-stale-check-requested";
import { initEventBridgeSaveLinkRawHtmlCommand } from "./providers/events/eventbridge-save-link-raw-html-command";
import { initEventBridgeSaveLinkRawPdfCommand } from "./providers/events/eventbridge-save-link-raw-pdf-command";
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
import { initInMemorySaveLinkRawPdfCommand } from "@packages/test-fixtures/providers/events";
import { initInMemoryRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import { initInMemoryUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { initPutPendingHtml } from "./providers/pending-html/put-pending-html";
import { initPutPendingPdf } from "./providers/pending-pdf/put-pending-pdf";
import { initInMemoryPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import { initInMemoryPendingPdf } from "@packages/test-fixtures/providers/pending-pdf";
import { initInMemoryImportSession } from "@packages/test-fixtures/providers/import-session";
import { initDynamoDbImportSession } from "./providers/import-session/dynamodb-import-session";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryInboxEmail, initInMemoryInboxEmailLink } from "@packages/test-fixtures/providers/inbox-email";
import { initDynamoDbInboxAddress } from "./providers/inbox-address/dynamodb-inbox-address";
import { initDynamoDbInboxEmail } from "./providers/inbox-email/dynamodb-inbox-email";
import { initDynamoDbInboxEmailLink } from "./providers/inbox-email/dynamodb-inbox-email-link";
import { initExchangeGoogleCode } from "./providers/google-auth/google-token";
import { initExchangeAppleCode } from "./providers/apple-auth/apple-token";
import { initCreateAppleClientSecret } from "./providers/apple-auth/apple-client-secret";
import { deriveStateSigningSecret } from "./providers/apple-auth/apple-state-secret";
import { initInMemoryStripeCheckout } from "@packages/test-fixtures/providers/stripe-checkout";
import { initStripeCheckout } from "./providers/stripe-checkout/stripe-checkout";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { initDynamoDbPendingSignup } from "./providers/pending-signup/dynamodb-pending-signup";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import { initDynamoDbSubscriptionRead } from "./providers/subscription-providers/dynamodb-subscription-read";
import { initDynamoDbSubscriptionWrites } from "./providers/subscription-providers/dynamodb-subscription-writes";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { initLogParseError, type ParseErrorEvent } from "@packages/hutch-infra-components";
import { isBlockedIpAddress, validateSaveableUrl } from "@packages/domain/article";
import { createApp } from "./server";
import { initChangelogBannerSource } from "./web/changelog-banner-source";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { AnalyticsEvent } from "./web/middleware/analytics";
import { httpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initCachedUserCount } from "./web/auth/cached-user-count";
import { getEnv, requireEnv } from "@packages/require-env";

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
	assert(
		persistence === "prod" || persistence === "development",
		`PERSISTENCE must be "prod" or "development", got "${persistence}"`,
	);
	const logger = HutchLogger.from(consoleLogger);
	const logError = (message: string, error?: Error) => logger.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack }));

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
		const appOriginForRedirect = requireEnv("APP_ORIGIN");
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
		const inboxEmailsTable = requireEnv("DYNAMODB_INBOX_EMAILS_TABLE");
		const inboxEmailLinksTable = requireEnv("DYNAMODB_INBOX_EMAIL_LINKS_TABLE");
		const inboxAddressDomain = requireEnv("INBOX_ADDRESS_DOMAIN");
		const subscriptionProvidersTable = requireEnv("DYNAMODB_SUBSCRIPTION_PROVIDERS_TABLE");
		const onboardingTable = requireEnv("DYNAMODB_ONBOARDING_TABLE");
		const rateLimitsTable = requireEnv("DYNAMODB_RATE_LIMITS_TABLE");
		const trialSchedulerGroupName = requireEnv("TRIAL_SCHEDULER_GROUP_NAME");
		const trialSchedulerRoleArn = requireEnv("TRIAL_SCHEDULER_ROLE_ARN");
		const eventBusArn = requireEnv("EVENT_BUS_ARN");
		const client = createDynamoDocumentClient();
		const s3Client = new S3Client({});
		const schedulerClient = new SchedulerClient({});

		const auth = initDynamoDbAuth({ client, usersTableName: usersTable, sessionsTableName: sessionsTable });
		const iosOnboardingSignal = initIosOnboardingSignal({ client, onboardingTableName: onboardingTable, now: () => new Date() });
		const articleStore = initDynamoDbArticleStore({ client, tableName: articlesTable, userArticlesTableName: userArticlesTable, logger });
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
		const { publishSaveLinkRawPdfCommand } = initEventBridgeSaveLinkRawPdfCommand({ publishEvent });
		const { putRefreshHtml } = initPutRefreshHtml({ client: s3Client, bucketName: pendingHtmlBucketName });
		const { publishRefreshArticleContent } = initEventBridgeRefreshArticleContent({ publishEvent, putRefreshHtml });
		const { publishUpdateFetchTimestamp } = initEventBridgeUpdateFetchTimestamp({ publishEvent });
		const { publishExportUserDataCommand } = initEventBridgeExportUserDataCommand({ publishEvent });
		const { publishCancelSubscriptionCommand } = initEventBridgeCancelSubscriptionCommand({ publishEvent });
		const { publishSubscriptionReactivated } = initEventBridgeSubscriptionReactivated({ publishEvent });
		const { putPendingHtml } = initPutPendingHtml({ client: new S3Client({}), bucketName: pendingHtmlBucketName });
		const { putPendingPdf } = initPutPendingPdf({ client: new S3Client({}), bucketName: pendingPdfBucketName });
		const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
		const siteRules = [
			theInformationSiteRules,
			mediumSiteRules,
			linkedinSiteRules,
			initXTwitterSiteRules({ crawlFetch, logError }),
		];
		const crawlArticle = initCrawlArticle({ crawlFetch, siteRules, extractPdf, logError });
		const extractLinksFromPageUrl = initExtractLinksFromPageUrl({ crawlFetch, validateUrl: validateSaveableUrl });
		const { parseHtml } = initReadabilityParser({
			crawlArticle,
			siteRules,
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
		const inboxEmailStore = initDynamoDbInboxEmail({ client, tableName: inboxEmailsTable });
		const inboxEmailLinkStore = initDynamoDbInboxEmailLink({ client, tableName: inboxEmailLinksTable });
		const readEmailContent = initS3ReadContent({
			send: (cmd) => s3Client.send(cmd),
			bucketName: contentBucketName,
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
			inboxAddressStore,
			inboxEmailStore,
			inboxEmailLinkStore,
			readEmailContent,
			inboxAddressDomain,
			subscriptionProviders,
			trialScheduler,
			createSubscriptionOnExistingCustomer: stripeSubscriptions.createSubscriptionOnExistingCustomer,
			reverseScheduledCancellation: stripeSubscriptions.reverseScheduledCancellation,
			paymentMethods,
			stripePriceId,
			stripePublishableKey,

			...initResendEmail(resendApiKey),
			...initDynamoDbEmailVerification({ client, tableName: verificationTokensTable }),
			...initDynamoDbPasswordReset({ client, tableName: passwordResetTokensTable }),
			...stripe,
			...pendingSignup,
			googleAuth,
			appleAuth,
			oauthModel,
			validateAccessToken: createValidateAccessToken(oauthModel),
			findOAuthClient: oauthClientLookup.findClient,
			validateOAuthRedirectUri: oauthClientLookup.validateRedirectUri,
			registerOAuthClient: oauthClients.registerClient,
			publishLinkSaved,
			publishRecrawlLinkInitiated,
			publishSaveAnonymousLink,
			publishStaleCheckRequested,
			publishSaveLinkRawHtmlCommand,
			publishSaveLinkRawPdfCommand,
			publishUpdateFetchTimestamp,
			publishExportUserDataCommand,
			publishCancelSubscriptionCommand,
			publishSubscriptionReactivated,
			putPendingHtml,
			putPendingPdf,
			findGeneratedSummary: summaryStore.findGeneratedSummary,
			markSummaryPending: summaryStore.markSummaryPending,
			findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
			markCrawlPending: crawlStore.markCrawlPending,
			forceMarkCrawlPending: crawlStore.forceMarkCrawlPending,
			refreshArticleIfStale,
			getIosAppSignals: iosOnboardingSignal.getIosAppSignals,
			recordIosAnyActivity: iosOnboardingSignal.recordIosAnyActivity,
			recordIosSavedArticle: iosOnboardingSignal.recordIosSavedArticle,
			consumeRateLimit,
			rateLimitRules,
		};
	}

	const auth = initInMemoryAuth({ hashPassword, verifyPassword });
	const iosOnboardingSignal = initInMemoryIosOnboardingSignal();
	const articleStore = initInMemoryArticleStore();
	const oauthClients = initInMemoryOAuthClients({ now: () => new Date() });
	const oauthClientLookup = initOAuthClientLookup({ dynamic: oauthClients });
	const oauthModel = createOAuthModel(initInMemoryOAuthModel(), {
		findUserById: auth.findUserById,
		findClient: oauthClientLookup.findClient,
		markClientActive: oauthClientLookup.markClientActive,
	});
	const devStripe = initInMemoryStripeCheckout({ checkoutBaseUrl: "https://checkout.stripe.test", now: () => new Date() });
	const devStripeSubscriptions = initInMemoryStripeSubscriptions();
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
			: undefined;
	const crawlStore = initInMemoryArticleCrawl();
	const summaryStore = initInMemoryGeneratedSummary();
	const { publishStaleCheckRequested } = initInMemoryStaleCheckRequested({ logger: consoleLogger });
	const extractPdf = createPdfDeferralStub(publishStaleCheckRequested);
	const siteRules = [
		theInformationSiteRules,
		mediumSiteRules,
		linkedinSiteRules,
		initXTwitterSiteRules({ crawlFetch, logError }),
	];
	const crawlArticle = initCrawlArticle({ crawlFetch, siteRules, extractPdf, logError });
	const extractLinksFromPageUrl = initExtractLinksFromPageUrl({ crawlFetch, validateUrl: validateSaveableUrl });
	const { parseHtml } = initReadabilityParser({
		crawlArticle,
		siteRules,
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
		if (result.status === "not-modified") return;
		await articleStore.writeContent({ url, content: result.article.html });
		await crawlStore.markCrawlReady({ url });
		await finaliseSummaryFromContent({ url, html: result.article.html });
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
	const { publishSaveLinkRawPdfCommand } = initInMemorySaveLinkRawPdfCommand({ logger: consoleLogger });
	const { publishExportUserDataCommand } = initInMemoryExportUserDataCommand({ logger: consoleLogger });
	const { publishCancelSubscriptionCommand } = initInMemoryCancelSubscriptionCommand({ logger: consoleLogger });
	const { publishSubscriptionReactivated } = initInMemorySubscriptionReactivated({ logger: consoleLogger });
	const { putPendingHtml } = initInMemoryPendingHtml();
	const { putPendingPdf } = initInMemoryPendingPdf();
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
	const inboxAddressStore = initInMemoryInboxAddress({ now: () => new Date() });
	const inboxEmailStore = initInMemoryInboxEmail();
	const inboxEmailLinkStore = initInMemoryInboxEmailLink();
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
		inboxAddressStore,
		inboxEmailStore,
		inboxEmailLinkStore,
		readEmailContent: articleStore.readContent,
		inboxAddressDomain,
		subscriptionProviders: devSubscriptionProviders,
		trialScheduler: devTrialScheduler,
		createSubscriptionOnExistingCustomer: devStripeSubscriptions.createSubscriptionOnExistingCustomer,
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
		validateAccessToken: createValidateAccessToken(oauthModel),
		findOAuthClient: oauthClientLookup.findClient,
		validateOAuthRedirectUri: oauthClientLookup.validateRedirectUri,
		registerOAuthClient: oauthClients.registerClient,
		publishLinkSaved,
		publishRecrawlLinkInitiated,
		publishSaveAnonymousLink,
		publishStaleCheckRequested,
		publishSaveLinkRawHtmlCommand,
		publishSaveLinkRawPdfCommand,
		publishUpdateFetchTimestamp,
		publishExportUserDataCommand,
		publishCancelSubscriptionCommand,
		publishSubscriptionReactivated,
		putPendingHtml,
		putPendingPdf,
		findGeneratedSummary: summaryStore.findGeneratedSummary,
		markSummaryPending: summaryStore.markSummaryPending,
		findArticleCrawlStatus: crawlStore.findArticleCrawlStatus,
		markCrawlPending: crawlStore.markCrawlPending,
		forceMarkCrawlPending: crawlStore.forceMarkCrawlPending,
		refreshArticleIfStale,
		getIosAppSignals: iosOnboardingSignal.getIosAppSignals,
		recordIosAnyActivity: iosOnboardingSignal.recordIosAnyActivity,
		recordIosSavedArticle: iosOnboardingSignal.recordIosSavedArticle,
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
	const { auth, articleStore, oauthModel, validateAccessToken, importSessionStore, ...providers } = initProviders();

	const appOrigin = deps?.appOrigin ?? requireEnv("APP_ORIGIN");
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
		countUsers: initCachedUserCount({ countUsers: auth.countUsers, now: () => Date.now(), ttlMs: 60_000 }),
		adminEmails,
		recrawlServiceToken,
		baseUrl: appOrigin,
		logError: (message, error) => HutchLogger.from(consoleLogger).error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack })),
		oauthModel,
		validateAccessToken,
		httpErrorMessageMapping,
		logParseError,
		importSessionStore,
		getChangelogBanner,
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
