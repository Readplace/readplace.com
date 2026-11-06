import type { ReadTimedDuration } from "@packages/domain";
import { MEDIA_KINDS, type MediaKindManifest, type MediaKindName, type Meter } from "@packages/media-contracts";
import {
	initInMemoryTranscriptCharge,
	initInMemoryTranscriptLedger,
	initInMemoryTranscriptQuotaRows,
} from "@packages/test-fixtures/providers/transcript-quota";
import { GUEST_UPLOAD_KINDS } from "./web/pages/upload/upload-review.page";
import { initRequestResolutionOnView } from "./domain/resolve-on-view/request-resolution-on-view";
import { KEEP_OFFER_ENDS_AT } from "./domain/engagement/keep-offer";
import express, { type Express } from "express";
import { type Logger, noopLogger } from "@packages/logger";
import { initRefreshWithSaveIdentity, initResolveCanonicalIdentity, initResolveSaveIdentity, neverResolveWrapperTarget, type ResolveSaveIdentity } from "@packages/save-article";
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
	BrowserHandoffBundle,
	PaymentMethodsBundle,
	PendingHtmlBundle,
	PendingPdfBundle,
	PendingUploadBundle,
	MediaUploadBundle,
	PendingSignupBundle,
	RunningServer,
	HostedCheckoutBundle,
	SubscriptionBillingBundle,
	SubscriptionProvidersBundle,
	TestAppFixture,
	TrialSchedulerBundle,
	WrapperTargetBundle,
} from "@packages/web-test-harness";
import { useTestServer as useServerForFixture } from "@packages/web-test-harness";
import { initReadArticleImageByIdentity } from "./providers/read-article-image-by-identity";
import { createApp } from "./server";
import { initFetchFirefoxDownloadUrl, type FetchFirefoxDownloadUrl } from "./web/pages/install";
import { batchFromSingular } from "./batch-from-singular";
import { readplaceUnwrapPreprocessor } from "./web/pages/view/readplace-unwrap-preprocessor";
import { READER_SECTION_PAGE_THRESHOLD_BYTES } from "./web/shared/article-body/reader-slot/section-pages";
import { unwrappedPreProcessors, withUnwrapPreprocessing } from "./web/unwrap-preprocessors";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { isStaticAssetRequestPath } from "./web/static-asset-paths";
import { type AnalyticsEvent, createAnalyticsMiddleware } from "@packages/web-analytics";
import { createViewerIdentityMiddleware } from "@packages/viewer-identity";
import { DEFAULT_INBOX_ADDRESS_PURPOSE, DEFAULT_INBOX_ALIAS } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type {
	SubscriptionLogEvent,
	SubscriptionLogEventView,
} from "./observability/subscription-events";
import type { ActivationThresholdReachedEvent } from "./domain/engagement/funnel-events";
import type { LifecycleEmailSentEvent } from "./observability/lifecycle-email-events";

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
	BrowserHandoffBundle,
	PaymentMethodsBundle,
	PendingHtmlBundle,
	PendingPdfBundle,
	PendingSignupBundle,
	SharedBundle,
	HostedCheckoutBundle,
	SubscriptionBillingBundle,
	SubscriptionProvidersBundle,
	RelatedArticlesBundle,
	SummaryBundle,
	TestAppFixture,
	TrialSchedulerBundle,
} from "@packages/web-test-harness";

export const TEST_EDGE_SECRET = "test-edge-secret";
export const TEST_KEEP_OFFER_COUPON_ID = "coupon_test_keep_offer";
export { loginAgent } from "@packages/web-test-harness";
export { TEST_APP_ORIGIN } from "@packages/test-fixtures";
import { BROWSER_USER_AGENT } from "@packages/web-test-harness";

interface TestAppOverrides {
	drawRandomByte?: () => number;
	getSessionUserId?: GetSessionUserId;
	resolveCanonicalIdentity?: (url: string) => Promise<string>;
	fetchFirefoxDownloadUrl?: FetchFirefoxDownloadUrl;
	keepOfferEndsAt?: Date;
	guestUploadKinds?: readonly MediaKindName[];
	readerSectionThresholdBytes?: number;
	mediaKinds?: ReadonlyMap<MediaKindName, MediaKindManifest>;
	readDurationByMeter?: ReadonlyMap<Meter, ReadTimedDuration>;
}

export const TEST_TRANSCRIPT_ALLOWANCE_SECONDS = 1250;

export const TEST_FIREFOX_XPI_FILENAME = "abc123-1.0.0.xpi";

/** Answers the Firefox latest-pointer lookup the way the S3 pointer object
 * would, so the install page never leaves the process under test. */
export function fakeFirefoxPointerFetch(body: string, status = 200): typeof fetch {
	return async () => new Response(body, { status });
}

export interface AnalyticsBundle {
	logger: Logger.Typed<AnalyticsEvent>;
	events: AnalyticsEvent[];
}

export interface SubscriptionEventsBundle {
	logger: Logger.Typed<SubscriptionLogEvent>;
	events: SubscriptionLogEventView[];
}

export interface FunnelEventsBundle {
	logger: Logger.Typed<ActivationThresholdReachedEvent | LifecycleEmailSentEvent>;
	events: (ActivationThresholdReachedEvent | LifecycleEmailSentEvent)[];
}

export interface TestAppResult {
	app: Express;
	auth: AuthBundle;
	articleStore: ArticleStoreBundle;
	articleCrawl: ArticleCrawlBundle;
	wrapperTarget: WrapperTargetBundle;
	pendingHtml: PendingHtmlBundle;
	pendingPdf: PendingPdfBundle;
	pendingUpload: PendingUploadBundle;
	mediaUpload: MediaUploadBundle;
	oauthModel: OAuthModel;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	browserHandoff: BrowserHandoffBundle;
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
	funnelEvents: FunnelEventsBundle;
}

function flattenFixtureToAppDependencies(
	fixture: TestAppFixture,
	analyticsBundle: AnalyticsBundle,
	subscriptionBundle: SubscriptionEventsBundle,
	funnelBundle: FunnelEventsBundle,
): Parameters<typeof createApp>[0] {
	const transcriptQuotaRows = initInMemoryTranscriptQuotaRows();
	const saveIdentityDeps = {
		validateUrl: fixture.shared.validateSaveableUrl,
		findIdentityRow: fixture.articleStore.findIdentityRow,
		claimAlias: fixture.articleStore.claimAlias,
		now: fixture.shared.now,
	};
	const resolveSaveIdentity = initResolveSaveIdentity({ ...saveIdentityDeps, resolveWrapperTarget: neverResolveWrapperTarget });
	const resolveNetworkSaveIdentity = initResolveSaveIdentity({ ...saveIdentityDeps, resolveWrapperTarget: fixture.wrapperTarget.resolveWrapperTarget });
	const refreshWithIdentity = (resolveSaveIdentity: ResolveSaveIdentity) =>
		initRefreshWithSaveIdentity({ resolveSaveIdentity, refreshArticleIfStale: fixture.freshness.refreshArticleIfStale }).refreshArticleIfStale;
	return {
		validateSaveableUrl: withUnwrapPreprocessing(
			fixture.shared.validateSaveableUrl,
			unwrappedPreProcessors(readplaceUnwrapPreprocessor),
			{ selfHost: new URL(fixture.shared.appOrigin).host },
		),
		appOrigin: fixture.shared.appOrigin,
		readerSectionThresholdBytes: READER_SECTION_PAGE_THRESHOLD_BYTES,
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
		renewSession: fixture.auth.renewSession,
		getSessionUserId: fixture.auth.getSessionUserId,
		destroySession: fixture.auth.destroySession,
		destroyUserSessions: fixture.auth.destroyUserSessions,
		destroyOAuthGrantSessions: fixture.auth.destroyOAuthGrantSessions,
		markAccountDeleted: fixture.auth.markAccountDeleted,
		countUsers: fixture.auth.countUsers,
		countEarlyIntentionalSave: fixture.auth.countEarlyIntentionalSave,
		markActivationThresholdReached: fixture.auth.markActivationThresholdReached,
		setKeepOfferDismissed: fixture.auth.setKeepOfferDismissed,
		markEmailVerified: fixture.auth.markEmailVerified,
		markSessionEmailVerified: fixture.auth.markSessionEmailVerified,
		setSessionReadlistFilter: fixture.auth.setSessionReadlistFilter,
		findSessionReadlistFilter: fixture.auth.findSessionReadlistFilter,
		findSessionOAuthGrant: fixture.auth.findSessionOAuthGrant,
		findUserById: fixture.auth.findUserById,
		findUserPasswordStatus: fixture.auth.findUserPasswordStatus,
		setUserAppearance: fixture.auth.setUserAppearance,
		setQueueDigestOptOut: fixture.auth.setQueueDigestOptOut,
		setUserDisplayName: fixture.auth.setUserDisplayName,
		userExistsByEmail: fixture.auth.userExistsByEmail,
		updatePassword: fixture.auth.updatePassword,
		findEmailByUserId: fixture.auth.findEmailByUserId,
		findArticleById: fixture.articleStore.findArticleById,
		findArticleByUrl: fixture.articleStore.findArticleByUrl,
		findArticleFreshness: fixture.articleStore.findArticleFreshness,
		findArticleCrawlVersions: fixture.articleStore.findArticleCrawlVersions,
		findArticleUrlById: fixture.articleStore.findArticleUrlById,
		findArticlesByUser: fixture.articleStore.findArticlesByUser,
		findArticlesAcrossReadlists: fixture.articleStore.findArticlesAcrossReadlists,
		countArticlesByUser: fixture.articleStore.countArticlesByUser,
		saveArticle: fixture.articleStore.saveArticle,
		saveArticleKeepingPosition: fixture.articleStore.saveArticleKeepingPosition,
		allocateSavedAt: fixture.articleStore.allocateSavedAt,
		allocateSavedAtSequence: fixture.articleStore.allocateSavedAtSequence,
		findSavedUrls: fixture.articleStore.findSavedUrls,
		saveArticleGlobally: fixture.articleStore.saveArticleGlobally,
		deleteArticle: fixture.articleStore.deleteArticle,
		updateArticleStatus: fixture.articleStore.updateArticleStatus,
		markArticleViewed: fixture.articleStore.markArticleViewed,
		findReadlistArticles: fixture.articleStore.findReadlistArticles,
		countReadlistArticles: fixture.articleStore.countReadlistArticles,
		findReadlistArticleById: fixture.articleStore.findReadlistArticleById,
		updateArticleStatusAcrossReadlists: fixture.articleStore.updateArticleStatusAcrossReadlists,
		deleteReadlistArticle: fixture.articleStore.deleteReadlistArticle,
		markReadlistArticleViewed: fixture.articleStore.markReadlistArticleViewed,
		listUserSavesForUrl: fixture.articleStore.listUserSavesForUrl,
		listUserSavesForUrls: fixture.articleStore.listUserSavesForUrls,
		deleteArticleHighlights: fixture.highlights.deleteArticleHighlights,
		listArticleHighlights: fixture.highlights.listArticleHighlights,
		createHighlight: fixture.highlights.createHighlight,
		deleteHighlight: fixture.highlights.deleteHighlight,
		assignSavedArticleToReadlist: fixture.articleStore.assignSavedArticleToReadlist,
		saveReadlistArticle: fixture.articleStore.saveReadlistArticle,
		moveReadlistArticles: fixture.articleStore.moveReadlistArticles,
		listReadlistDefinitions: fixture.articleStore.listReadlistDefinitions,
		renameReadlistDefinition: fixture.articleStore.renameReadlistDefinition,
		setReadlistDefinitionPurpose: fixture.articleStore.setReadlistDefinitionPurpose,
		clearReadlistDefinitionPurpose: fixture.articleStore.clearReadlistDefinitionPurpose,
		createReadlistDefinition: fixture.articleStore.createReadlistDefinition,
		deleteReadlistDefinition: fixture.articleStore.deleteReadlistDefinition,
		purgeReadlistFitOverrides: fixture.articleStore.purgeReadlistFitOverrides,
		listReadlistFitOverrides: fixture.articleStore.listReadlistFitOverrides,
		deleteReadlistFitOverride: fixture.articleStore.deleteReadlistFitOverride,
		markSummaryToggled: fixture.articleStore.markSummaryToggled,
		recordEngagementActivity: fixture.engagementStarter.recordEngagementActivity,
		markRelatedDismissed: fixture.articleStore.markRelatedDismissed,
		readArticleContent: fixture.articleStore.readArticleContent,
		findItemOwner: fixture.articleStore.findItemOwner,
		readArticleImage: initReadArticleImageByIdentity({
			shared: fixture.articleStore.readArticleImage,
			private: fixture.articleStore.readArticleImage,
		}),
		findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
		findArticleCrawlStatuses: batchFromSingular(fixture.articleCrawl.findArticleCrawlStatus),
		markCrawlPending: fixture.articleCrawl.markCrawlPending,
		forceMarkCrawlPending: fixture.articleCrawl.forceMarkCrawlPending,
		publishLinkSaved: fixture.events.publishLinkSaved,
		publishLinkQueued: fixture.events.publishLinkQueued,
		publishLinkDequeued: fixture.events.publishLinkDequeued,
		publishQueueEntryCreated: fixture.events.publishQueueEntryCreated,
		publishComputeRelatedPastReads: fixture.events.publishComputeRelatedPastReads,
		publishComputeRelatedPasses: fixture.events.publishComputeRelatedPasses,
		requestResolutionOnView: initRequestResolutionOnView({
			claimResolutionOnView: fixture.resolutionOnView.claimResolutionOnView,
			publishResolveArticleOnView: fixture.resolutionOnView.publishResolveArticleOnView,
			findArticleCrawlStatus: fixture.articleCrawl.findArticleCrawlStatus,
			findGeneratedSummary: fixture.summary.findGeneratedSummary,
			logger: noopLogger,
			now: () => new Date(),
		}),
		publishRecrawlLinkInitiated: fixture.events.publishRecrawlLinkInitiated,
		publishRemoveMyContent: fixture.events.publishRemoveMyContent,
		publishSaveAnonymousLink: fixture.events.publishSaveAnonymousLink,
		publishSubmitLink: fixture.submitLink.publishSubmitLink,
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
		findRelatedArticles: fixture.relatedArticles.findRelatedArticles,
		readRelatedPassRequestState: fixture.relatedArticles.readRelatedPassRequestState,
		markRelatedPassesRequested: fixture.relatedArticles.markRelatedPassesRequested,
		findPastReads: fixture.pastReads.findPastReads,
		findGeneratedSummary: fixture.summary.findGeneratedSummary,
		findGeneratedSummaries: ({ urls, viewer }) =>
			batchFromSingular((url: string) => fixture.summary.findGeneratedSummary({ url, viewer }))(urls),
		markSummaryPending: fixture.summary.markSummaryPending,
		refreshArticleIfStale: refreshWithIdentity(resolveNetworkSaveIdentity),
		refreshArticleIfStaleStored: refreshWithIdentity(resolveSaveIdentity),
		resolveCanonicalIdentity: initResolveCanonicalIdentity({ findIdentityRow: fixture.articleStore.findIdentityRow }),
		findIdentityRow: fixture.articleStore.findIdentityRow,
		resolveFirstVisitIdentity: resolveNetworkSaveIdentity,
		resolveWrapperTarget: fixture.wrapperTarget.resolveWrapperTarget,
		pinContentSource: fixture.articleStore.pinContentSource,
		findContentSourceUrl: fixture.articleStore.findContentSourceUrl,
		oauthModel: fixture.oauth.oauthModel,
		revokeAllUserOAuthTokens: fixture.oauth.revokeAllUserOAuthTokens,
		revokeOtherUserOAuthGrants: fixture.oauth.revokeOtherUserOAuthGrants,
		listUserOAuthClients: fixture.oauth.listUserOAuthClients,
		revokeUserOAuthClient: fixture.oauth.revokeUserOAuthClient,
		validateAccessToken: fixture.oauth.validateAccessToken,
		findOAuthClient: fixture.oauth.findClient,
		validateOAuthRedirectUri: fixture.oauth.validateRedirectUri,
		registerOAuthClient: fixture.oauth.registerClient,
		sendEmail: fixture.email.sendEmail,
		createVerificationToken: fixture.emailVerification.createVerificationToken,
		verifyEmailToken: fixture.emailVerification.verifyEmailToken,
		createPasswordResetToken: fixture.passwordReset.createPasswordResetToken,
		verifyPasswordResetToken: fixture.passwordReset.verifyPasswordResetToken,
		mintBrowserHandoffCode: fixture.browserHandoff.mintBrowserHandoffCode,
		redeemBrowserHandoffCode: fixture.browserHandoff.redeemBrowserHandoffCode,
		consumeRateLimit: fixture.rateLimit.consumeRateLimit,
		rateLimitRules: fixture.rateLimit.rules,
		getOnboardingSignals: fixture.onboardingSignals.getOnboardingSignals,
		recordNativeAppAnyActivity: fixture.onboardingSignals.recordNativeAppAnyActivity,
		recordNativeAppSavedArticle: fixture.onboardingSignals.recordNativeAppSavedArticle,
		recordNextReadMinimumReached: fixture.onboardingSignals.recordNextReadMinimumReached,
		recordEmailStepMarkedDone: fixture.onboardingSignals.recordEmailStepMarkedDone,
		recordGmailStepDismissed: fixture.onboardingSignals.recordGmailStepDismissed,
		recordOnboardingOutstandingVersion: fixture.onboardingSignals.recordOnboardingOutstandingVersion,
		recordMarkReadAcrossQueuesAcknowledged:
			fixture.onboardingSignals.recordMarkReadAcrossQueuesAcknowledged,
		recordDeleteArticleAcknowledged: fixture.onboardingSignals.recordDeleteArticleAcknowledged,
		googleAuth: fixture.google,
		gmailIntegration: fixture.gmailIntegration,
		readNewsletterCatalog: fixture.newsletterCatalog.readNewsletterCatalog,
		writeNewsletterCatalog: fixture.newsletterCatalog.writeNewsletterCatalog,
		newsletterCatalogSeed: fixture.newsletterCatalog.newsletterCatalogSeed,
		findCanaryReport: fixture.canaryReports.findCanaryReport,
		adminDashboards: fixture.adminDashboards,
		appleAuth: fixture.apple,
		adminEmails: fixture.admin.adminEmails,
		recrawlServiceToken: fixture.admin.recrawlServiceToken,
		importSessionStore: fixture.importSession.importSessionStore,
		savePrivateItem: fixture.articleStore.savePrivateItem,
		...fixture.mediaUpload,
		mediaKinds: MEDIA_KINDS,
		readDurationByMeter: new Map(),
		transcriptAllowanceSeconds: TEST_TRANSCRIPT_ALLOWANCE_SECONDS,
		...initInMemoryTranscriptCharge({
			rows: transcriptQuotaRows,
			allowanceSeconds: TEST_TRANSCRIPT_ALLOWANCE_SECONDS,
			now: fixture.shared.now,
		}),
		refundUnstartedCharge: initInMemoryTranscriptLedger({ rows: transcriptQuotaRows }).refundUnstartedCharge,
		extractLinksFromPageUrl: fixture.importSession.extractLinksFromPageUrl,
		provisionInboxAddress: (userId: UserId) =>
			fixture.inboxAddress.inboxAddressStore
				.createAddress({
					userId,
					domain: fixture.inboxAddress.inboxAddressDomain,
					name: DEFAULT_INBOX_ALIAS,
					purpose: DEFAULT_INBOX_ADDRESS_PURPOSE,
				})
				.then(() => undefined),
		listInboxAddresses: fixture.inboxAddress.inboxAddressStore.listAddressesByUserId,
		setInboxAddressReadlist: fixture.inboxAddress.inboxAddressStore.setAddressReadlist,
		clearReadlistFromAddresses: fixture.inboxAddress.inboxAddressStore.clearReadlistFromAddresses,
		listIssueLinks: fixture.inboxEmail.inboxEmailLinkStore.listLinksByEmail,
		findIssueLink: fixture.inboxEmail.inboxEmailLinkStore.getLink,
		findIssueLinkSaveStates: fixture.inboxEmail.inboxSavedLinkStore.findSavedLinks,
		now: fixture.shared.now,
		drawRandomByte: () => 0,
		retrieveCheckoutSession: fixture.hostedCheckout.retrieveCheckoutSession,
		createCheckoutSession: fixture.hostedCheckout.createCheckoutSession,
		consumePendingSignup: fixture.pendingSignup.consumePendingSignup,
		storePendingSignup: fixture.pendingSignup.storePendingSignup,
		subscriptionProviders: {
			upsertActive: fixture.subscriptionProviders.upsertActive,
			recordFounderNote: fixture.subscriptionProviders.recordFounderNote,
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
			createTrialNudgeSchedule: fixture.trialScheduler.createTrialNudgeSchedule,
			createChargeReminderSchedule: fixture.trialScheduler.createChargeReminderSchedule,
		},
		createSubscriptionOnExistingCustomer:
			fixture.subscriptionBilling.createSubscriptionOnExistingCustomer,
		findSubscriptionNextCharge:
			fixture.subscriptionBilling.findSubscriptionNextCharge,
		listInvoices: fixture.subscriptionBilling.listInvoices,
		reverseScheduledCancellation:
			fixture.subscriptionBilling.reverseScheduledCancellation,
		paymentMethods: {
			listCards: fixture.paymentMethods.listCards,
			beginAddCard: fixture.paymentMethods.beginAddCard,
			getCardSetupResult: fixture.paymentMethods.getCardSetupResult,
			removeCard: fixture.paymentMethods.removeCard,
			setPrimaryCard: fixture.paymentMethods.setPrimaryCard,
		},
		resolvePriceId: fixture.resolvePriceId,
		stripePublishableKey: fixture.stripePublishableKey,
		botDefenseLogger: fixture.botDefense.logger,
		conversionLogger: fixture.conversions.logger,
		subscriptionLogger: subscriptionBundle.logger,
		funnelLogger: funnelBundle.logger,
		analytics: analyticsBundle.logger,
		authDiagnosticsLogger: noopLogger,
		salt: "test-analytics-salt",
		keepOfferCouponId: TEST_KEEP_OFFER_COUPON_ID,
		keepOfferEndsAt: KEEP_OFFER_ENDS_AT,
		guestUploadKinds: GUEST_UPLOAD_KINDS,
		foundingAllocation: initFoundingAllocation({
			foundingMemberLimit: fixture.foundingAllocation.foundingMemberLimit,
		}),
		fetchFirefoxDownloadUrl: initFetchFirefoxDownloadUrl({
			fetch: fakeFirefoxPointerFetch(TEST_FIREFOX_XPI_FILENAME),
		}),
	};
}

export const BROWSER_REQUEST_HEADERS: Record<string, string> = {
	"User-Agent": BROWSER_USER_AGENT,
	"Accept-Language": "en-US,en;q=0.9",
	"Sec-CH-UA": '"Chromium";v="145", "Google Chrome";v="145", "Not?A_Brand";v="24"',
	"Sec-Fetch-Mode": "navigate",
	"Sec-Fetch-Dest": "document",
};

/** `overrides` lets a test swap a single dependency without rebuilding the whole
 * fixture — `getSessionUserId` (so a test can make the session
 * lookup throw and assert the request still degrades to guest),
 * and `resolveCanonicalIdentity`. */
export function createTestApp(
	fixture: TestAppFixture,
	overrides?: TestAppOverrides,
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
	const funnelLogEvents: FunnelEventsBundle["events"] = [];
	const captureFunnel = (data: ActivationThresholdReachedEvent | LifecycleEmailSentEvent) => { funnelLogEvents.push(data); };
	const funnelBundle: FunnelEventsBundle = {
		logger: { info: captureFunnel, error: captureFunnel, warn: captureFunnel, debug: captureFunnel },
		events: funnelLogEvents,
	};
	const app = express()
		.use(createViewerIdentityMiddleware({ edgeSecret: TEST_EDGE_SECRET }))
		.use(createAnalyticsMiddleware({
			logger: analyticsBundle.logger,
			salt: "test-analytics-salt",
			now: fixture.shared.now,
			isStaticAssetPath: isStaticAssetRequestPath,
			ownHost: new URL(fixture.shared.appOrigin).hostname,
		}))
		.use(createApp({ ...flattenFixtureToAppDependencies(fixture, analyticsBundle, subscriptionBundle, funnelBundle), ...overrides }));
	return {
		app,
		auth: fixture.auth,
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		wrapperTarget: fixture.wrapperTarget,
		pendingHtml: fixture.pendingHtml,
		pendingPdf: fixture.pendingPdf,
		pendingUpload: fixture.pendingUpload,
		mediaUpload: fixture.mediaUpload,
		oauthModel: fixture.oauth.oauthModel,
		email: fixture.email,
		emailVerification: fixture.emailVerification,
		passwordReset: fixture.passwordReset,
		browserHandoff: fixture.browserHandoff,
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
		funnelEvents: funnelBundle,
	};
}

export interface TestAppHarness extends TestAppResult, RunningServer {}

export function useTestServer(overrides?: TestAppOverrides): (fixture: TestAppFixture) => TestAppHarness {
	return useServerForFixture((fixture) => createTestApp(fixture, overrides));
}
