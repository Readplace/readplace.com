/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { createDynamoDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbAuth } from "./auth/dynamodb-auth";
import { initOnboardingSignals } from "./onboarding-signals/dynamodb-onboarding-signals";
import { initDynamoDbReadlistDefinitions, initDynamoDbSavedArticleStore } from "@packages/article-store";
import { CRAWL_PERSONAS, initCrawlFetch } from "@packages/crawl-article";
import { initExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import { initSubmitFreshness } from "@packages/save-article";
import { initDynamoDbOAuthModel } from "./oauth/dynamodb-oauth-model";
import { initDynamoDbOAuthClients } from "./oauth/dynamodb-oauth-clients";
import { initOAuthClientLookup } from "@packages/domain/oauth";
import { createValidateAccessToken } from "@packages/web-session";
import { initResendEmail } from "./email/resend-email";
import { initSkipReservedDomain } from "./email/skip-reserved-domain";
import { initDynamoDbEmailVerification } from "./email-verification/dynamodb-email-verification";
import { initDynamoDbPasswordReset } from "./password-reset/dynamodb-password-reset";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import { initDynamoDbRateLimit } from "./rate-limit/dynamodb-rate-limit";
import { initDynamoDbGeneratedSummary, initDynamoDbRelatedArticles } from "@packages/article-store";
import { initDynamoDbArticleCrawl } from "@packages/article-store";
import { S3Client } from "@aws-sdk/client-s3";
import { SchedulerClient } from "@aws-sdk/client-scheduler";
import { initS3ReadContent, initS3ReadArticleImage } from "@packages/article-store";
import { initStripeSubscriptions } from "./stripe-subscriptions/stripe-subscriptions";
import { initStripePaymentMethods } from "./stripe-payment-methods/stripe-payment-methods";
import { initAwsTrialScheduler } from "./trial-scheduler/aws-trial-scheduler";
import { initReadArticleContent } from "@packages/article-store";
import { initCanonicalAliasStore, initResolveCanonicalIdentity } from "@packages/article-store";
import { EventBridgeClient, initEventBridgePublisher } from "@packages/hutch-infra-components/runtime";
import { initEventBridgeLinkDequeued } from "./events/eventbridge-link-dequeued";
import { initEventBridgeQueueEntryCreated } from "./events/eventbridge-queue-entry-created";
import { initEventBridgeLinkQueued } from "./events/eventbridge-link-queued";
import { initEventBridgeLinkSaved } from "./events/eventbridge-link-saved";
import { initEventBridgeRecrawlLinkInitiated } from "./events/eventbridge-recrawl-link-initiated";
import { initEventBridgeRemoveMyContent } from "./events/eventbridge-remove-my-content";
import { initEventBridgeSaveAnonymousLink } from "./events/eventbridge-save-anonymous-link";
import { initEventBridgeStaleCheckRequested } from "./events/eventbridge-stale-check-requested";
import { initEventBridgeSaveLinkRawHtmlCommand } from "./events/eventbridge-save-link-raw-html-command";
import { initEventBridgeSaveLinkRawPdfCommand } from "./events/eventbridge-save-link-raw-pdf-command";
import { initEventBridgeUpdateFetchTimestamp } from "./events/eventbridge-update-fetch-timestamp";
import { initEventBridgeExportUserDataCommand } from "./events/eventbridge-export-user-data-command";
import { initEventBridgeDeleteAccountCommand } from "./events/eventbridge-delete-account-command";
import { initEventBridgeCancelSubscriptionCommand } from "./events/eventbridge-cancel-subscription-command";
import { initEventBridgeSubscriptionReactivated } from "./events/eventbridge-subscription-reactivated";
import { initPutPendingHtml } from "./pending-html/put-pending-html";
import { initPutPendingPdf } from "./pending-pdf/put-pending-pdf";
import { initS3PendingUpload } from "./pending-upload/s3-pending-upload";
import { createPresignerClient } from "./pending-upload/mint-upload-url";
import { UPLOAD_SLOT_TTL_SECONDS } from "../web/pages/readlist/upload-slot-ttl";
import { initDynamoDbImportSession } from "./import-session/dynamodb-import-session";
import { initExchangeGoogleCode } from "./google-auth/google-token";
import { initExchangeGmailCode } from "./gmail-oauth/gmail-token";
import { deriveGmailStateSigningSecret } from "./gmail-oauth/gmail-state-secret";
import {
	initDynamoDbGmailConnection,
	initDynamoDbGmailCredentials,
	initDynamoDbGmailSender,
} from "@packages/inbox-store";
import { DisconnectGmailCommand, RewriteGmailFilterCommand } from "@packages/hutch-infra-components";
import { initExchangeAppleCode } from "./apple-auth/apple-token";
import { initCreateAppleClientSecret } from "./apple-auth/apple-client-secret";
import { deriveStateSigningSecret } from "./apple-auth/apple-state-secret";
import { initStripeCheckout } from "./stripe-checkout/stripe-checkout";
import { initDynamoDbPendingSignup } from "./pending-signup/dynamodb-pending-signup";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDynamoDbSubscriptionWrites } from "./subscription-providers/dynamodb-subscription-writes";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { isBlockedIpAddress, validateSaveableUrl } from "@packages/domain/article";
import { requireEnv } from "@packages/require-env";
import { initDynamoDbInboxAddress } from "@packages/inbox-store";
import { DEFAULT_INBOX_ADDRESS_PURPOSE, DEFAULT_INBOX_ALIAS, GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
import { aliasNameForSender } from "@packages/domain/gmail";
import type { ForwardableSender } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

/** `appOrigin` is threaded in rather than read from the environment because the
 * dev server may have bound a different port than `APP_ORIGIN` names, and every
 * absolute URL handed to a client has to point back at this process. */
export function initProdProviders(input: { appOrigin: string }) {
	const logger = HutchLogger.from(consoleLogger);
	const logError = (message: string, error?: Error) => logger.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack }));
	const logInfo = (message: string) => logger.info(JSON.stringify({ level: "INFO", timestamp: new Date().toISOString(), message }));

	const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, personas: CRAWL_PERSONAS, isBlocked: isBlockedIpAddress, logInfo, proxyUrl: undefined });

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
	const gmailClientId = requireEnv("GMAIL_INTEGRATION_CLIENT_ID");
	const gmailClientSecret = requireEnv("GMAIL_INTEGRATION_CLIENT_SECRET");
	const gmailStateSeed = requireEnv("GMAIL_INTEGRATION_STATE_SECRET");
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
	const rateLimitsTable = requireEnv("DYNAMODB_RATE_LIMITS_TABLE");
	const trialSchedulerGroupName = requireEnv("TRIAL_SCHEDULER_GROUP_NAME");
	const trialSchedulerRoleArn = requireEnv("TRIAL_SCHEDULER_ROLE_ARN");
	const eventBusArn = requireEnv("EVENT_BUS_ARN");
	const client = createDynamoDocumentClient();
	const s3Client = new S3Client({});
	const schedulerClient = new SchedulerClient({});

	const auth = initDynamoDbAuth({ client, usersTableName: usersTable, sessionsTableName: sessionsTable });
	const onboardingSignals = initOnboardingSignals({ client, onboardingTableName: onboardingTable, now: () => new Date() });
	const articleStore = initDynamoDbSavedArticleStore({ client, tableName: articlesTable, userArticlesTableName: userArticlesTable, logger, now: () => new Date() });
	const queueDefinitions = initDynamoDbReadlistDefinitions({ client, userArticlesTableName: userArticlesTable });
	const canonicalAlias = initCanonicalAliasStore({ client, tableName: articlesTable });
	const resolveCanonicalIdentity = initResolveCanonicalIdentity({ resolveAlias: canonicalAlias.resolveAlias });
	const readArticleContent = initReadArticleContent({
		storageProviderQueryOrder: [
			initS3ReadContent({ send: (cmd) => s3Client.send(cmd), bucketName: contentBucketName }),
			articleStore.readContent, // Legacy fallback for articles saved before S3 migration
		],
		logError,
	});
	const readArticleImage = initS3ReadArticleImage({
		send: (cmd) => s3Client.send(cmd),
		bucketName: contentBucketName,
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
	const relatedArticlesStore = initDynamoDbRelatedArticles({
		client,
		tableName: articlesTable,
		userArticlesTableName: userArticlesTable,
	});
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
	const { publishLinkDequeued } = initEventBridgeLinkDequeued({ publishEvent });
	const { publishQueueEntryCreated } = initEventBridgeQueueEntryCreated({ publishEvent });
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

	const gmailIntegration = {
		exchangeGmailCode: initExchangeGmailCode({
			clientId: gmailClientId,
			clientSecret: gmailClientSecret,
			redirectUri: `${appOriginForRedirect}/integrations/gmail/callback`,
			fetch: globalThis.fetch,
		}),
		clientId: gmailClientId,
		stateSecret: deriveGmailStateSigningSecret(gmailStateSeed),
		gmailCredentialsStore: initDynamoDbGmailCredentials({
			client,
			tableName: requireEnv("DYNAMODB_GMAIL_CREDENTIALS_TABLE"),
			now: () => new Date(),
		}),
		gmailConnectionStore: initDynamoDbGmailConnection({
			client,
			tableName: requireEnv("DYNAMODB_GMAIL_CONNECTIONS_TABLE"),
			now: () => new Date(),
		}),
		gmailSenderStore: initDynamoDbGmailSender({
			client,
			tableName: requireEnv("DYNAMODB_GMAIL_SENDERS_TABLE"),
			now: () => new Date(),
		}),
		mintGatewayAddress: async ({ userId }: { userId: UserId }) => {
			const entry = await inboxAddressStore.createAddress({
				userId,
				domain: inboxAddressDomain,
				name: GMAIL_FORWARDING_ALIAS,
				purpose: "gmail-forwarding",
			});
			return entry.address;
		},
		mintSenderAddress: async ({ senderEmail, userId }: {
			userId: UserId;
			senderEmail: ForwardableSender;
		}) => {
			const entry = await inboxAddressStore.createAddress({
				userId,
				domain: inboxAddressDomain,
				name: aliasNameForSender(senderEmail),
				purpose: "gmail-mapped",
			});
			return entry.address;
		},
		publishRewriteGmailFilter: async (detail: {
			userId: UserId;
			reason: "forwarding-confirmed" | "sender-added" | "sender-removed" | "requested";
		}) => {
			await publishEvent(RewriteGmailFilterCommand, detail);
		},
		publishDisconnectGmail: async (detail: { userId: UserId }) => {
			await publishEvent(DisconnectGmailCommand, detail);
		},
	};
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
		...auth,
		...articleStore,
		...queueDefinitions,
		readArticleContent,
		readArticleImage,
		importSessionStore,
		extractLinksFromPageUrl,
		provisionInboxAddress: async (userId: UserId) => {
			await inboxAddressStore.createAddress({
				userId,
				domain: inboxAddressDomain,
				name: DEFAULT_INBOX_ALIAS,
				purpose: DEFAULT_INBOX_ADDRESS_PURPOSE,
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
		gmailIntegration,
		appleAuth,
		oauthModel,
		revokeAllUserOAuthTokens: oauthModel.revokeAllUserOAuthTokens,
		validateAccessToken: createValidateAccessToken(oauthModel),
		findOAuthClient: oauthClientLookup.findClient,
		validateOAuthRedirectUri: oauthClientLookup.validateRedirectUri,
		registerOAuthClient: oauthClients.registerClient,
		publishLinkSaved,
		publishLinkQueued,
		publishLinkDequeued,
		publishQueueEntryCreated,
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
		findRelatedArticles: relatedArticlesStore.findRelatedArticles,
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
		getOnboardingSignals: onboardingSignals.getOnboardingSignals,
		recordNativeAppAnyActivity: onboardingSignals.recordNativeAppAnyActivity,
		recordNativeAppSavedArticle: onboardingSignals.recordNativeAppSavedArticle,
		recordNextReadMinimumReached: onboardingSignals.recordNextReadMinimumReached,
		recordNextReadStepOutstanding: onboardingSignals.recordNextReadStepOutstanding,
		recordMarkReadAcrossQueuesAcknowledged:
			onboardingSignals.recordMarkReadAcrossQueuesAcknowledged,
		recordDeleteArticleAcknowledged: onboardingSignals.recordDeleteArticleAcknowledged,
		consumeRateLimit,
		rateLimitRules,
	};
}
/* c8 ignore stop */
