import express, { type Express } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import type { GetSessionUserId } from "@packages/provider-contracts/auth";
import type { OAuthModel } from "@packages/provider-contracts/oauth";
import type {
	ArticleCrawlBundle,
	ArticleStoreBundle,
	AuthBundle,
	BotDefenseBundle,
	ConversionsBundle,
	EmailBundle,
	EmailVerificationBundle,
	PasswordResetBundle,
	PaymentMethodsBundle,
	PendingHtmlBundle,
	PendingPdfBundle,
	PendingUploadBundle,
	PendingSignupBundle,
	RunningServer,
	HostedCheckoutBundle,
	SubscriptionBillingBundle,
	SubscriptionProvidersBundle,
	TestAppFixture,
	TrialSchedulerBundle,
} from "@packages/web-test-harness";
import { useTestServer as useServerForFixture } from "@packages/web-test-harness";
import { createApp } from "./server";
import { readplaceUnwrapPreprocessor } from "./web/pages/view/readplace-unwrap-preprocessor";
import { unwrappedPreProcessors, withUnwrapPreprocessing } from "./web/unwrap-preprocessors";
import type { GetChangelogBanner } from "./web/changelog-banner-source";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { type AnalyticsEvent, createAnalyticsMiddleware } from "@packages/web-analytics";
import { DEFAULT_INBOX_ALIAS } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type {
	SubscriptionLogEvent,
	SubscriptionLogEventView,
} from "./observability/subscription-events";

export type {
	AdminBundle,
	ArticleCrawlBundle,
	ArticleStoreBundle,
	AuthBundle,
	BotDefenseBundle,
	ConversionsBundle,
	EmailBundle,
	EmailVerificationBundle,
	EventsBundle,
	FoundingAllocationBundle,
	FreshnessBundle,
	GoogleAuthBundle,
	ImportSessionBundle,
	OAuthBundle,
	ParserBundle,
	PasswordResetBundle,
	PaymentMethodsBundle,
	PendingHtmlBundle,
	PendingPdfBundle,
	PendingSignupBundle,
	SharedBundle,
	HostedCheckoutBundle,
	SubscriptionBillingBundle,
	SubscriptionProvidersBundle,
	SummaryBundle,
	TestAppFixture,
	TrialSchedulerBundle,
} from "@packages/web-test-harness";
export { loginAgent } from "@packages/web-test-harness";

export interface AnalyticsBundle {
	logger: HutchLogger.Typed<AnalyticsEvent>;
	events: AnalyticsEvent[];
}

export interface SubscriptionEventsBundle {
	logger: HutchLogger.Typed<SubscriptionLogEvent>;
	events: SubscriptionLogEventView[];
}

export interface TestAppResult {
	app: Express;
	auth: AuthBundle;
	articleStore: ArticleStoreBundle;
	articleCrawl: ArticleCrawlBundle;
	pendingHtml: PendingHtmlBundle;
	pendingPdf: PendingPdfBundle;
	pendingUpload: PendingUploadBundle;
	oauthModel: OAuthModel;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	hostedCheckout: HostedCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	subscriptionProviders: SubscriptionProvidersBundle;
	trialScheduler: TrialSchedulerBundle;
	subscriptionBilling: SubscriptionBillingBundle;
	paymentMethods: PaymentMethodsBundle;
	botDefense: BotDefenseBundle;
	conversions: ConversionsBundle;
	analytics: AnalyticsBundle;
	subscriptionEvents: SubscriptionEventsBundle;
}

function flattenFixtureToAppDependencies(
	fixture: TestAppFixture,
	analyticsBundle: AnalyticsBundle,
	subscriptionBundle: SubscriptionEventsBundle,
): Parameters<typeof createApp>[0] {
	return {
		validateSaveableUrl: withUnwrapPreprocessing(
			fixture.shared.validateSaveableUrl,
			unwrappedPreProcessors(readplaceUnwrapPreprocessor),
			{ selfHost: new URL(fixture.shared.appOrigin).host },
		),
		appOrigin: fixture.shared.appOrigin,
		staticBaseUrl: fixture.shared.staticBaseUrl,
		baseUrl: fixture.shared.appOrigin,
		logError: fixture.shared.logError,
		httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
		hashPassword: fixture.auth.hashPassword,
		createUser: fixture.auth.createUser,
		createUserWithPasswordHash: fixture.auth.createUserWithPasswordHash,
		createGoogleUser: fixture.auth.createGoogleUser,
		createAppleUser: fixture.auth.createAppleUser,
		saveAppleRefreshToken: fixture.auth.saveAppleRefreshToken,
		findUserByEmail: fixture.auth.findUserByEmail,
		verifyCredentials: fixture.auth.verifyCredentials,
		createSession: fixture.auth.createSession,
		getSessionUserId: fixture.auth.getSessionUserId,
		destroySession: fixture.auth.destroySession,
		destroyUserSessions: fixture.auth.destroyUserSessions,
		countUsers: fixture.auth.countUsers,
		markEmailVerified: fixture.auth.markEmailVerified,
		markSessionEmailVerified: fixture.auth.markSessionEmailVerified,
		findUserById: fixture.auth.findUserById,
		userExistsByEmail: fixture.auth.userExistsByEmail,
		existsUserByIdPrefix: fixture.auth.existsUserByIdPrefix,
		updatePassword: fixture.auth.updatePassword,
		findEmailByUserId: fixture.auth.findEmailByUserId,
		findArticleById: fixture.articleStore.findArticleById,
		findArticleByUrl: fixture.articleStore.findArticleByUrl,
		findArticleFreshness: fixture.articleStore.findArticleFreshness,
		findArticleCrawlVersions: fixture.articleStore.findArticleCrawlVersions,
		findArticleUrlById: fixture.articleStore.findArticleUrlById,
		findArticlesByUser: fixture.articleStore.findArticlesByUser,
		countArticlesByUser: fixture.articleStore.countArticlesByUser,
		saveArticle: fixture.articleStore.saveArticle,
		saveArticleGlobally: fixture.articleStore.saveArticleGlobally,
		deleteArticle: fixture.articleStore.deleteArticle,
		updateArticleStatus: fixture.articleStore.updateArticleStatus,
		markArticleViewed: fixture.articleStore.markArticleViewed,
		markSummaryToggled: fixture.articleStore.markSummaryToggled,
		readArticleContent: fixture.articleStore.readArticleContent,
		findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
		markCrawlPending: fixture.articleCrawl.markCrawlPending,
		forceMarkCrawlPending: fixture.articleCrawl.forceMarkCrawlPending,
		publishLinkSaved: fixture.events.publishLinkSaved,
		publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
		publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
		publishStaleCheckRequested: fixture.events.publishStaleCheckRequested,
		publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
		publishSaveLinkRawPdfCommand: fixture.events.publishSaveLinkRawPdfCommand,
		publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
		publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
		publishDeleteAccountCommand: fixture.events.publishDeleteAccountCommand,
		publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
		publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
		putPendingHtml: fixture.pendingHtml.putPendingHtml,
		putPendingPdf: fixture.pendingPdf.putPendingPdf,
		createUploadSlot: fixture.pendingUpload.createUploadSlot,
		statPendingUpload: fixture.pendingUpload.statPendingUpload,
		readPendingUploadPrefix: fixture.pendingUpload.readPendingUploadPrefix,
		findGeneratedSummary: fixture.summary.findGeneratedSummary,
		markSummaryPending: fixture.summary.markSummaryPending,
		refreshArticleIfStale: fixture.freshness.refreshArticleIfStale,
		resolveCanonicalIdentity: async (url: string) => url,
		oauthModel: fixture.oauth.oauthModel,
		revokeAllUserOAuthTokens: fixture.oauth.revokeAllUserOAuthTokens,
		validateAccessToken: fixture.oauth.validateAccessToken,
		findOAuthClient: fixture.oauth.findClient,
		validateOAuthRedirectUri: fixture.oauth.validateRedirectUri,
		registerOAuthClient: fixture.oauth.registerClient,
		sendEmail: fixture.email.sendEmail,
		createVerificationToken: fixture.emailVerification.createVerificationToken,
		verifyEmailToken: fixture.emailVerification.verifyEmailToken,
		createPasswordResetToken: fixture.passwordReset.createPasswordResetToken,
		verifyPasswordResetToken: fixture.passwordReset.verifyPasswordResetToken,
		consumeRateLimit: fixture.rateLimit.consumeRateLimit,
		rateLimitRules: fixture.rateLimit.rules,
		getIosAppSignals: fixture.iosOnboardingSignal.getIosAppSignals,
		recordIosAnyActivity: fixture.iosOnboardingSignal.recordIosAnyActivity,
		recordIosSavedArticle: fixture.iosOnboardingSignal.recordIosSavedArticle,
		googleAuth: fixture.google,
		appleAuth: fixture.apple,
		adminEmails: fixture.admin.adminEmails,
		recrawlServiceToken: fixture.admin.recrawlServiceToken,
		importSessionStore: fixture.importSession.importSessionStore,
		extractLinksFromPageUrl: fixture.importSession.extractLinksFromPageUrl,
		provisionInboxAddress: (userId: UserId) =>
			fixture.inboxAddress.inboxAddressStore
				.createAddress({
					userId,
					domain: fixture.inboxAddress.inboxAddressDomain,
					name: DEFAULT_INBOX_ALIAS,
				})
				.then(() => undefined),
		getChangelogBanner: async () => undefined,
		now: fixture.shared.now,
		retrieveCheckoutSession: fixture.hostedCheckout.retrieveCheckoutSession,
		createCheckoutSession: fixture.hostedCheckout.createCheckoutSession,
		consumePendingSignup: fixture.pendingSignup.consumePendingSignup,
		storePendingSignup: fixture.pendingSignup.storePendingSignup,
		subscriptionProviders: {
			upsertActive: fixture.subscriptionProviders.upsertActive,
			upsertTrialing: fixture.subscriptionProviders.upsertTrialing,
			findByUserId: fixture.subscriptionProviders.findByUserId,
			markActive: fixture.subscriptionProviders.markActive,
			setNextCharge: fixture.subscriptionProviders.setNextCharge,
		},
		trialScheduler: {
			createTrialEndSchedule: fixture.trialScheduler.createTrialEndSchedule,
			deleteTrialEndSchedule: fixture.trialScheduler.deleteTrialEndSchedule,
			deleteDeferredCancellationSchedule:
				fixture.trialScheduler.deleteDeferredCancellationSchedule,
			deleteTrialFeedbackEmailSchedule:
				fixture.trialScheduler.deleteTrialFeedbackEmailSchedule,
			createTrialReminderSchedule: fixture.trialScheduler.createTrialReminderSchedule,
			deleteTrialReminderSchedule: fixture.trialScheduler.deleteTrialReminderSchedule,
			createChargeReminderSchedule: fixture.trialScheduler.createChargeReminderSchedule,
		},
		createSubscriptionOnExistingCustomer:
			fixture.subscriptionBilling.createSubscriptionOnExistingCustomer,
		findSubscriptionNextCharge:
			fixture.subscriptionBilling.findSubscriptionNextCharge,
		reverseScheduledCancellation:
			fixture.subscriptionBilling.reverseScheduledCancellation,
		paymentMethods: {
			listCards: fixture.paymentMethods.listCards,
			beginAddCard: fixture.paymentMethods.beginAddCard,
			getCardSetupResult: fixture.paymentMethods.getCardSetupResult,
			removeCard: fixture.paymentMethods.removeCard,
			setPrimaryCard: fixture.paymentMethods.setPrimaryCard,
		},
		stripePriceId: fixture.stripePriceId,
		stripePublishableKey: fixture.stripePublishableKey,
		botDefenseLogger: fixture.botDefense.logger,
		conversionLogger: fixture.conversions.logger,
		subscriptionLogger: subscriptionBundle.logger,
		analytics: analyticsBundle.logger,
		salt: "test-analytics-salt",
		foundingAllocation: initFoundingAllocation({
			foundingMemberLimit: fixture.foundingAllocation.foundingMemberLimit,
		}),
		expiryCountdown: "enabled",
	};
}

/** `overrides` lets a test swap a single dependency without rebuilding the whole
 * fixture — `getChangelogBanner` (defaults to "no banner" so it stays hidden in
 * every other route test), and `getSessionUserId` (so a test can make the session
 * lookup throw and assert the request still degrades to guest). */
export function createTestApp(
	fixture: TestAppFixture,
	overrides?: {
		getChangelogBanner?: GetChangelogBanner;
		getSessionUserId?: GetSessionUserId;
	},
): TestAppResult {
	const analyticsEvents: AnalyticsEvent[] = [];
	const captureAnalytics = (data: AnalyticsEvent) => { analyticsEvents.push(data); };
	const analyticsBundle: AnalyticsBundle = {
		logger: { info: captureAnalytics, error: captureAnalytics, warn: captureAnalytics, debug: captureAnalytics },
		events: analyticsEvents,
	};
	const subscriptionLogEvents: SubscriptionLogEventView[] = [];
	const captureSubscription = (data: SubscriptionLogEvent) => { subscriptionLogEvents.push(data); };
	const subscriptionBundle: SubscriptionEventsBundle = {
		logger: { info: captureSubscription, error: captureSubscription, warn: captureSubscription, debug: captureSubscription },
		events: subscriptionLogEvents,
	};
	const app = express()
		.use(createAnalyticsMiddleware({
			logger: analyticsBundle.logger,
			salt: "test-analytics-salt",
			now: fixture.shared.now,
		}))
		.use(createApp({ ...flattenFixtureToAppDependencies(fixture, analyticsBundle, subscriptionBundle), ...overrides }));
	return {
		app,
		auth: fixture.auth,
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		pendingHtml: fixture.pendingHtml,
		pendingPdf: fixture.pendingPdf,
		pendingUpload: fixture.pendingUpload,
		oauthModel: fixture.oauth.oauthModel,
		email: fixture.email,
		emailVerification: fixture.emailVerification,
		passwordReset: fixture.passwordReset,
		hostedCheckout: fixture.hostedCheckout,
		pendingSignup: fixture.pendingSignup,
		subscriptionProviders: fixture.subscriptionProviders,
		trialScheduler: fixture.trialScheduler,
		subscriptionBilling: fixture.subscriptionBilling,
		paymentMethods: fixture.paymentMethods,
		botDefense: fixture.botDefense,
		conversions: fixture.conversions,
		analytics: analyticsBundle,
		subscriptionEvents: subscriptionBundle,
	};
}

export interface TestAppHarness extends TestAppResult, RunningServer {}

export function useTestServer(overrides?: {
	getChangelogBanner?: GetChangelogBanner;
	getSessionUserId?: GetSessionUserId;
}): (fixture: TestAppFixture) => TestAppHarness {
	return useServerForFixture((fixture) => createTestApp(fixture, overrides));
}
