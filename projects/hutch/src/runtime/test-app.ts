import type { Express } from "express";
import type { HutchLogger } from "@packages/hutch-logger";
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
	PendingHtmlBundle,
	PendingPdfBundle,
	PendingSignupBundle,
	RunningServer,
	StripeCheckoutBundle,
	StripeSubscriptionsBundle,
	SubscriptionProvidersBundle,
	TestAppFixture,
	TrialSchedulerBundle,
} from "@packages/web-test-harness";
import { useTestServer as useServerForFixture } from "@packages/web-test-harness";
import { createApp } from "./server";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import type { AnalyticsEvent } from "./web/middleware/analytics";

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
	PendingHtmlBundle,
	PendingPdfBundle,
	PendingSignupBundle,
	SharedBundle,
	StripeCheckoutBundle,
	StripeSubscriptionsBundle,
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

export interface TestAppResult {
	app: Express;
	auth: AuthBundle;
	articleStore: ArticleStoreBundle;
	articleCrawl: ArticleCrawlBundle;
	pendingHtml: PendingHtmlBundle;
	pendingPdf: PendingPdfBundle;
	oauthModel: OAuthModel;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	stripe: StripeCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	subscriptionProviders: SubscriptionProvidersBundle;
	trialScheduler: TrialSchedulerBundle;
	stripeSubscriptions: StripeSubscriptionsBundle;
	botDefense: BotDefenseBundle;
	conversions: ConversionsBundle;
	analytics: AnalyticsBundle;
}

function flattenFixtureToAppDependencies(
	fixture: TestAppFixture,
	analyticsBundle: AnalyticsBundle,
): Parameters<typeof createApp>[0] {
	return {
		validateSaveableUrl: fixture.shared.validateSaveableUrl,
		appOrigin: fixture.shared.appOrigin,
		staticBaseUrl: fixture.shared.staticBaseUrl,
		baseUrl: fixture.shared.appOrigin,
		logError: fixture.shared.logError,
		logParseError: fixture.shared.logParseError,
		httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
		hashPassword: fixture.auth.hashPassword,
		createUser: fixture.auth.createUser,
		createUserWithPasswordHash: fixture.auth.createUserWithPasswordHash,
		createGoogleUser: fixture.auth.createGoogleUser,
		findUserByEmail: fixture.auth.findUserByEmail,
		verifyCredentials: fixture.auth.verifyCredentials,
		createSession: fixture.auth.createSession,
		getSessionUserId: fixture.auth.getSessionUserId,
		destroySession: fixture.auth.destroySession,
		countUsers: fixture.auth.countUsers,
		markEmailVerified: fixture.auth.markEmailVerified,
		markSessionEmailVerified: fixture.auth.markSessionEmailVerified,
		userExistsByEmail: fixture.auth.userExistsByEmail,
		existsUserByIdPrefix: fixture.auth.existsUserByIdPrefix,
		updatePassword: fixture.auth.updatePassword,
		findEmailByUserId: fixture.auth.findEmailByUserId,
		findArticleById: fixture.articleStore.findArticleById,
		findArticleByUrl: fixture.articleStore.findArticleByUrl,
		findArticleUrlById: fixture.articleStore.findArticleUrlById,
		findArticlesByUser: fixture.articleStore.findArticlesByUser,
		countArticlesByUser: fixture.articleStore.countArticlesByUser,
		saveArticle: fixture.articleStore.saveArticle,
		saveArticleGlobally: fixture.articleStore.saveArticleGlobally,
		deleteArticle: fixture.articleStore.deleteArticle,
		updateArticleStatus: fixture.articleStore.updateArticleStatus,
		markArticleViewed: fixture.articleStore.markArticleViewed,
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
		publishCancelSubscriptionCommand: fixture.events.publishCancelSubscriptionCommand,
		publishSubscriptionReactivated: fixture.events.publishSubscriptionReactivated,
		putPendingHtml: fixture.pendingHtml.putPendingHtml,
		putPendingPdf: fixture.pendingPdf.putPendingPdf,
		findGeneratedSummary: fixture.summary.findGeneratedSummary,
		markSummaryPending: fixture.summary.markSummaryPending,
		refreshArticleIfStale: fixture.freshness.refreshArticleIfStale,
		oauthModel: fixture.oauth.oauthModel,
		validateAccessToken: fixture.oauth.validateAccessToken,
		sendEmail: fixture.email.sendEmail,
		createVerificationToken: fixture.emailVerification.createVerificationToken,
		verifyEmailToken: fixture.emailVerification.verifyEmailToken,
		createPasswordResetToken: fixture.passwordReset.createPasswordResetToken,
		verifyPasswordResetToken: fixture.passwordReset.verifyPasswordResetToken,
		googleAuth: fixture.google,
		adminEmails: fixture.admin.adminEmails,
		recrawlServiceToken: fixture.admin.recrawlServiceToken,
		importSessionStore: fixture.importSession.importSessionStore,
		extractLinksFromPageUrl: fixture.importSession.extractLinksFromPageUrl,
		now: fixture.shared.now,
		retrieveCheckoutSession: fixture.stripe.retrieveCheckoutSession,
		createCheckoutSession: fixture.stripe.createCheckoutSession,
		consumePendingSignup: fixture.pendingSignup.consumePendingSignup,
		storePendingSignup: fixture.pendingSignup.storePendingSignup,
		subscriptionProviders: {
			upsertActive: fixture.subscriptionProviders.upsertActive,
			upsertTrialing: fixture.subscriptionProviders.upsertTrialing,
			findByUserId: fixture.subscriptionProviders.findByUserId,
			markActive: fixture.subscriptionProviders.markActive,
		},
		trialScheduler: {
			createTrialEndSchedule: fixture.trialScheduler.createTrialEndSchedule,
			deleteTrialEndSchedule: fixture.trialScheduler.deleteTrialEndSchedule,
			deleteDeferredCancellationSchedule:
				fixture.trialScheduler.deleteDeferredCancellationSchedule,
		},
		createSubscriptionOnExistingCustomer:
			fixture.stripeSubscriptions.createSubscriptionOnExistingCustomer,
		reverseScheduledCancellation:
			fixture.stripeSubscriptions.reverseScheduledCancellation,
		stripePriceId: fixture.stripePriceId,
		botDefenseLogger: fixture.botDefense.logger,
		conversionLogger: fixture.conversions.logger,
		analytics: analyticsBundle.logger,
		salt: "test-analytics-salt",
		foundingAllocation: initFoundingAllocation({
			foundingMemberLimit: fixture.foundingAllocation.foundingMemberLimit,
		}),
		expiryCountdown: "enabled",
	};
}

export function createTestApp(fixture: TestAppFixture): TestAppResult {
	const analyticsEvents: AnalyticsEvent[] = [];
	const captureAnalytics = (data: AnalyticsEvent) => { analyticsEvents.push(data); };
	const analyticsBundle: AnalyticsBundle = {
		logger: { info: captureAnalytics, error: captureAnalytics, warn: captureAnalytics, debug: captureAnalytics },
		events: analyticsEvents,
	};
	const app = createApp(flattenFixtureToAppDependencies(fixture, analyticsBundle));
	return {
		app,
		auth: fixture.auth,
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		pendingHtml: fixture.pendingHtml,
		pendingPdf: fixture.pendingPdf,
		oauthModel: fixture.oauth.oauthModel,
		email: fixture.email,
		emailVerification: fixture.emailVerification,
		passwordReset: fixture.passwordReset,
		stripe: fixture.stripe,
		pendingSignup: fixture.pendingSignup,
		subscriptionProviders: fixture.subscriptionProviders,
		trialScheduler: fixture.trialScheduler,
		stripeSubscriptions: fixture.stripeSubscriptions,
		botDefense: fixture.botDefense,
		conversions: fixture.conversions,
		analytics: analyticsBundle,
	};
}

export interface TestAppHarness extends TestAppResult, RunningServer {}

export function useTestServer(): (fixture: TestAppFixture) => TestAppHarness {
	return useServerForFixture(createTestApp);
}
