/* c8 ignore start -- composition root, no logic to test */
import assert from "node:assert";
import { blockedCauseForStatus } from "@packages/article-state-types";
import { initInMemoryAuth } from "@packages/test-fixtures/providers/auth";
import { initInMemoryGmailCredentials } from "@packages/test-fixtures/providers/gmail-credentials";
import { initExchangeGmailCode } from "./gmail-oauth/gmail-token";
import { deriveGmailStateSigningSecret } from "./gmail-oauth/gmail-state-secret";
import { hashPassword, verifyPassword } from "@packages/domain/user";
import { initInMemoryOnboardingSignals } from "@packages/test-fixtures/providers/onboarding-signals";
import { initInMemoryArticleStore } from "@packages/test-fixtures/providers/article-store";
import type { ExtractPdf } from "@packages/crawl-article";
import {
	CRAWL_PERSONAS,
	initCrawlArticle,
	initFetchPinnedCrawl,
	initCrawlFetch,
	initFetchThumbnailImage,
	initXTwitterSiteRules,
	initAppleNewsSiteRules,
	initStackOverflowSiteRules,
} from "@packages/crawl-article";
import { initExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import { initCrawlAndFinalizeArticle, initFinalizeArticle } from "@packages/finalize-article";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import { initReadabilityParser, linkedinSiteRules, mediaWikiSiteRules, mediumSiteRules, theInformationSiteRules } from "@packages/article-parser";
import { initRefreshArticleIfStale } from "@packages/finalize-article";
import {
	createOAuthModel,
	createRevokeAllUserOAuthTokens,
	initInMemoryOAuthClients,
	initInMemoryOAuthModel,
} from "@packages/test-fixtures/providers/oauth";
import { initOAuthClientLookup } from "@packages/domain/oauth";
import { createValidateAccessToken } from "@packages/web-session";
import { initLogEmail } from "./email/log-email";
import { initInMemoryEmailVerification } from "@packages/test-fixtures/providers/email-verification";
import { initInMemoryPasswordReset } from "@packages/test-fixtures/providers/password-reset";
import { initInMemoryRateLimit } from "@packages/test-fixtures/providers/rate-limit";
import type { RateLimitRules } from "@packages/provider-contracts/rate-limit";
import { parseRateLimitRule } from "@packages/domain/rate-limit";
import { devSummariseInline } from "./article-summary/dev-summarise-inline";
import { initInMemoryArticleCrawl } from "@packages/test-fixtures/providers/article-crawl";
import { initInMemoryGeneratedSummary } from "@packages/test-fixtures/providers/article-summary";
import { batchFromSingular } from "../batch-from-singular";
import { initReadArticleContent } from "@packages/article-store";
import { initInMemoryPaymentMethods } from "@packages/test-fixtures/providers/payment-methods";
import { initInMemorySubscriptionBilling } from "@packages/test-fixtures/providers/subscription-billing";
import { initInMemoryTrialScheduler } from "@packages/test-fixtures/providers/trial-scheduler";
import { initInMemorySubscriptionProviders } from "@packages/test-fixtures/providers/subscription-providers";
import {
	initInMemoryCancelSubscriptionCommand,
	initInMemoryDeleteAccountCommand,
	initInMemoryExportUserDataCommand,
	initInMemorySubscriptionReactivated,
} from "@packages/test-fixtures/providers/events";
import {
	initInMemoryQueueEntryCreated,
	initInMemoryLinkDequeued,
	initInMemoryLinkQueued,
	initInMemoryLinkSaved,
} from "@packages/test-fixtures/providers/events";
import { initInMemoryRelatedArticles } from "@packages/test-fixtures/providers/related-articles";
import { initInMemoryRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveAnonymousLink } from "@packages/test-fixtures/providers/events";
import { initInMemoryStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import { initInMemorySaveLinkRawPdfCommand } from "@packages/test-fixtures/providers/events";
import { initInMemoryRefreshArticleContent } from "@packages/test-fixtures/providers/events";
import { initInMemoryRemoveMyContent } from "@packages/test-fixtures/providers/events";
import { initInMemoryUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import { initInMemoryPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import { initInMemoryPendingPdf } from "@packages/test-fixtures/providers/pending-pdf";
import { initInMemoryPendingUpload } from "@packages/test-fixtures/providers/pending-upload";
import { UPLOAD_SLOT_TTL_SECONDS } from "../web/pages/readlist/upload-slot-ttl";
import { initInMemoryImportSession } from "@packages/test-fixtures/providers/import-session";
import { initInMemoryInboxAddress } from "@packages/test-fixtures/providers/inbox-address";
import { initInMemoryGmailConnection } from "@packages/test-fixtures/providers/gmail-connection";
import { initInMemoryGmailSender } from "@packages/test-fixtures/providers/gmail-sender";
import { aliasNameForSender } from "@packages/domain/gmail";
import type { ForwardableSender } from "@packages/domain/gmail";
import { initExchangeGoogleCode } from "./google-auth/google-token";
import { initExchangeAppleCode } from "./apple-auth/apple-token";
import { initCreateAppleClientSecret } from "./apple-auth/apple-client-secret";
import { deriveStateSigningSecret } from "./apple-auth/apple-state-secret";
import { initInMemoryHostedCheckout } from "@packages/test-fixtures/providers/hosted-checkout";
import { initInMemoryPendingSignup } from "@packages/test-fixtures/providers/pending-signup";
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { isBlockedIpAddress, validateSaveableUrl } from "@packages/domain/article";
import { getEnv, requireEnv } from "@packages/require-env";
import { DEFAULT_INBOX_ADDRESS_PURPOSE, DEFAULT_INBOX_ALIAS, GMAIL_FORWARDING_ALIAS } from "@packages/domain/inbox";
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

export function initDevProviders(input: { appOrigin: string }) {
	const logger = HutchLogger.from(consoleLogger);
	const logError = (message: string, error?: Error) => logger.error(JSON.stringify({ level: "ERROR", timestamp: new Date().toISOString(), message, stack: error?.stack }));
	const logInfo = (message: string) => logger.info(JSON.stringify({ level: "INFO", timestamp: new Date().toISOString(), message }));

	const crawlFetch = initCrawlFetch({ fetch: globalThis.fetch, personas: CRAWL_PERSONAS, isBlocked: isBlockedIpAddress, logInfo, proxyUrl: undefined });
	const staleTtlMs = 86400000;

	const auth = initInMemoryAuth({ hashPassword, verifyPassword });
	const onboardingSignals = initInMemoryOnboardingSignals({ now: () => new Date() });
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
	const inboxAddressStore = initInMemoryInboxAddress({ now: () => new Date() });
	const inboxAddressDomain = requireEnv("INBOX_ADDRESS_DOMAIN");
	const gmailClientId = getEnv("GMAIL_INTEGRATION_CLIENT_ID");
	const gmailClientSecret = getEnv("GMAIL_INTEGRATION_CLIENT_SECRET");
	const gmailStateSeed = getEnv("GMAIL_INTEGRATION_STATE_SECRET");
	assert(
		(gmailClientId && gmailClientSecret && gmailStateSeed) ||
			(!gmailClientId && !gmailClientSecret && !gmailStateSeed),
		"GMAIL_INTEGRATION_CLIENT_ID, GMAIL_INTEGRATION_CLIENT_SECRET and GMAIL_INTEGRATION_STATE_SECRET must all be set or all unset",
	);
	const gmailIntegration =
		gmailClientId && gmailClientSecret && gmailStateSeed
			? {
					exchangeGmailCode: initExchangeGmailCode({
						clientId: gmailClientId,
						clientSecret: gmailClientSecret,
						redirectUri: `http://localhost:${getEnv("PORT") || "3000"}/integrations/gmail/callback`,
						fetch: globalThis.fetch,
					}),
					clientId: gmailClientId,
					stateSecret: deriveGmailStateSigningSecret(gmailStateSeed),
					gmailCredentialsStore: initInMemoryGmailCredentials({ now: () => new Date() }),
					gmailConnectionStore: initInMemoryGmailConnection({ now: () => new Date() }),
					gmailSenderStore: initInMemoryGmailSender({ now: () => new Date() }),
					mintGatewayAddress: async ({ userId }: { userId: UserId }) => {
						const entry = await inboxAddressStore.createAddress({
							userId,
							domain: inboxAddressDomain,
							name: GMAIL_FORWARDING_ALIAS,
							purpose: "gmail-forwarding",
						});
						return entry.address;
					},
					mintSenderAddress: async ({
						userId,
						senderEmail,
					}: { userId: UserId; senderEmail: ForwardableSender }) => {
						const entry = await inboxAddressStore.createAddress({
							userId,
							domain: inboxAddressDomain,
							name: aliasNameForSender(senderEmail),
							purpose: "gmail-mapped",
						});
						return entry.address;
					},
					publishRewriteGmailFilter: async () => {},
					publishDisconnectGmail: async () => {},
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
		initStackOverflowSiteRules({ crawlFetch, logError }),
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
	const { publishLinkDequeued } = initInMemoryLinkDequeued({ logger: consoleLogger });
	const { publishQueueEntryCreated } = initInMemoryQueueEntryCreated({ logger: consoleLogger });
	const { findRelatedArticles } = initInMemoryRelatedArticles({
		findArticleByUrl: articleStore.findArticleByUrl,
		findArticleById: articleStore.findArticleById,
	});
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
		...auth,
		...articleStore,
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
				purpose: DEFAULT_INBOX_ADDRESS_PURPOSE,
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
		gmailIntegration,
		appleAuth,
		oauthModel,
		revokeAllUserOAuthTokens,
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
		findRelatedArticles,
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
