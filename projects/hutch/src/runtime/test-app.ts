import type { Server } from "node:http";
import type { Express } from "express";
import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { ParseArticle } from "@packages/article-parser";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";
import type { PublishRecrawlLinkInitiated } from "@packages/test-fixtures/providers/events";
import type { PublishSaveAnonymousLink } from "@packages/test-fixtures/providers/events";
import type { PublishStaleCheckRequested } from "@packages/test-fixtures/providers/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import type { PublishSaveLinkRawPdfCommand } from "@packages/test-fixtures/providers/events";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import type { PutPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import type { PutPendingPdf } from "@packages/test-fixtures/providers/pending-pdf";
import type {
	FindGeneratedSummary,
	ForceMarkSummaryPending,
	MarkSummaryPending,
} from "@packages/test-fixtures/providers/article-summary";
import type {
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	InMemoryMarkCrawlFailed,
	InMemoryMarkCrawlReady,
	InMemoryMarkCrawlStage,
	InMemoryMarkCrawlUnsupported,
} from "@packages/test-fixtures/providers/article-crawl";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type {
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	FindEmailByUserId,
	FindUserByEmail,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	UpdatePassword,
	UserExistsByEmail,
	VerifyCredentials,
	ExistsUserByIdPrefix,
} from "@packages/test-fixtures/providers/auth";
import type {
	PublishCancelSubscriptionCommand,
	PublishExportUserDataCommand,
	PublishSubscriptionReactivated,
} from "@packages/test-fixtures/providers/events";
import type {
	CheckoutSessionId,
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "@packages/test-fixtures/providers/stripe-checkout";
import type {
	ConsumePendingSignup,
	StorePendingSignup,
} from "@packages/test-fixtures/providers/pending-signup";
import type {
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	MarkSubscriptionCancelled,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/test-fixtures/providers/subscription-providers";
import type {
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
} from "@packages/test-fixtures/providers/trial-scheduler";
import type {
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
} from "@packages/test-fixtures/providers/stripe-subscriptions";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type {
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "@packages/test-fixtures/providers/article-store";
import type {
	ContentProvider,
	ReadArticleContent,
} from "@packages/test-fixtures/providers/article-store";
import type { SendEmail, EmailMessage } from "@packages/test-fixtures/providers/email";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "@packages/test-fixtures/providers/email-verification";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/test-fixtures/providers/password-reset";
import type { ExchangeGoogleCode } from "@packages/test-fixtures/providers/google-auth";
import type { OAuthModel } from "@packages/test-fixtures/providers/oauth";
import type { ValidateAccessToken } from "./web/dual-auth.middleware";
import type { ImportSessionStore } from "@packages/domain/import-session";
import request from "supertest";
import { createApp } from "./server";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import type { HttpErrorMessageMapping } from "./web/pages/queue/queue.error";
import { initFoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import type { AnalyticsEvent } from "./web/middleware/analytics";

export interface AuthBundle {
	hashPassword: (password: string) => Promise<string>;
	createUser: CreateUser;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	destroySession: DestroySession;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	userExistsByEmail: UserExistsByEmail;
	existsUserByIdPrefix: ExistsUserByIdPrefix;
	updatePassword: UpdatePassword;
	findEmailByUserId: FindEmailByUserId;
	deleteUser: (email: string) => Promise<void>;
}

export interface StripeCheckoutBundle {
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	markPaid: (id: CheckoutSessionId) => void;
	getCheckoutUrl: (id: CheckoutSessionId) => string;
}

export interface PendingSignupBundle {
	storePendingSignup: StorePendingSignup;
	consumePendingSignup: ConsumePendingSignup;
}

export interface SubscriptionProvidersBundle {
	findByUserId: FindSubscriptionByUserId;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelled: MarkSubscriptionCancelled;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
	seedRow: (row: {
		userId: import("@packages/domain/user").UserId;
		provider: "stripe";
		subscriptionId?: string;
		customerId?: string;
		status: "trialing" | "active" | "pending_cancellation" | "cancelled";
		trialEndsAt?: string;
		cancellationEffectiveAt?: string;
		createdAt: string;
		updatedAt: string;
	}) => void;
}

export interface TrialSchedulerBundle {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	getSchedule: (userId: import("@packages/domain/user").UserId) => string | undefined;
	allSchedules: () => readonly { userId: import("@packages/domain/user").UserId; firesAt: string }[];
	deleteCalls: () => readonly import("@packages/domain/user").UserId[];
	getDeferredCancellationSchedule: (
		userId: import("@packages/domain/user").UserId,
	) => string | undefined;
	allDeferredCancellationSchedules: () => readonly {
		userId: import("@packages/domain/user").UserId;
		firesAt: string;
	}[];
	deferredCancellationDeleteCalls: () => readonly import("@packages/domain/user").UserId[];
}

export interface StripeSubscriptionsBundle {
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	scheduleCancellationAtPeriodEnd: ScheduleCancellationAtPeriodEnd;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	createdSubscriptions: () => readonly { customerId: string; priceId: string; subscriptionId: string }[];
	scheduledCancellations: () => readonly { subscriptionId: string; cancellationEffectiveAt: string }[];
	reversedCancellations: () => readonly string[];
}

export interface ArticleStoreBundle {
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticleFreshness: FindArticleFreshness;
	findArticlesByUser: FindArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	readArticleContent: ReadArticleContent;
	readContent: ContentProvider;
	writeContent: (params: { url: string; content: string }) => Promise<void>;
	writeMetadata: (params: {
		url: string;
		metadata: ArticleMetadata;
		estimatedReadTime: Minutes;
	}) => Promise<void>;
	setContentSourceTier: (params: { url: string; tier: "tier-0" | "tier-1" }) => Promise<void>;
}

export interface ArticleCrawlBundle {
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
	markCrawlReady: InMemoryMarkCrawlReady;
	markCrawlFailed: InMemoryMarkCrawlFailed;
	markCrawlUnsupported: InMemoryMarkCrawlUnsupported;
	markCrawlStage: InMemoryMarkCrawlStage;
}

export interface ParserBundle {
	parseArticle: ParseArticle;
	crawlArticle: CrawlArticle;
}

export interface EventsBundle {
	publishLinkSaved: PublishLinkSaved;
	publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishExportUserDataCommand: PublishExportUserDataCommand;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
}

export interface PendingHtmlBundle {
	putPendingHtml: PutPendingHtml;
	readPendingHtml: (url: string) => string | undefined;
}

export interface PendingPdfBundle {
	putPendingPdf: PutPendingPdf;
	readPendingPdfSync: (url: string) => Buffer | undefined;
}

export interface SummaryBundle {
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	forceMarkSummaryPending: ForceMarkSummaryPending;
}

export interface FreshnessBundle {
	refreshArticleIfStale: RefreshArticleIfStale;
}

export interface OAuthBundle {
	oauthModel: OAuthModel;
	validateAccessToken: ValidateAccessToken;
}

export interface EmailBundle {
	sendEmail: SendEmail;
	getSentEmails: () => EmailMessage[];
}

export interface EmailVerificationBundle {
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
}

export interface PasswordResetBundle {
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
}

export interface GoogleAuthBundle {
	exchangeGoogleCode: ExchangeGoogleCode;
	clientId: string;
	clientSecret: string;
}

export interface AdminBundle {
	adminEmails: readonly string[];
	recrawlServiceToken: string;
}

export interface SharedBundle {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	staticBaseUrl: string;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	logError: (message: string, error?: Error) => void;
	logParseError: LogParseError;
	now: () => Date;
}

export interface ImportSessionBundle {
	importSessionStore: ImportSessionStore;
}

export interface BotDefenseBundle {
	logger: HutchLogger.Typed<BotDefenseEvent>;
	events: BotDefenseEvent[];
}

export interface ConversionsBundle {
	logger: HutchLogger.Typed<ConversionEvent>;
	events: ConversionEvent[];
}

/** Carries the founding-member cap as a plain number. The runtime predicate is
 * constructed via `initFoundingAllocation` inside `flattenFixtureToAppDependencies`
 * so the test-fixtures package can keep the same shape without importing from
 * projects/hutch (mirrors the SharedBundle.validateSaveableUrl pattern). */
export interface FoundingAllocationBundle {
	foundingMemberLimit: number;
}

export interface TestAppFixture {
	auth: AuthBundle;
	articleStore: ArticleStoreBundle;
	articleCrawl: ArticleCrawlBundle;
	parser: ParserBundle;
	events: EventsBundle;
	pendingHtml: PendingHtmlBundle;
	pendingPdf: PendingPdfBundle;
	summary: SummaryBundle;
	freshness: FreshnessBundle;
	oauth: OAuthBundle;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	google: GoogleAuthBundle | undefined;
	admin: AdminBundle;
	importSession: ImportSessionBundle;
	shared: SharedBundle;
	stripe: StripeCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	subscriptionProviders: SubscriptionProvidersBundle;
	trialScheduler: TrialSchedulerBundle;
	stripeSubscriptions: StripeSubscriptionsBundle;
	stripePriceId: string;
	botDefense: BotDefenseBundle;
	conversions: ConversionsBundle;
	foundingAllocation: FoundingAllocationBundle;
}

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
		saveArticle: fixture.articleStore.saveArticle,
		saveArticleGlobally: fixture.articleStore.saveArticleGlobally,
		deleteArticle: fixture.articleStore.deleteArticle,
		updateArticleStatus: fixture.articleStore.updateArticleStatus,
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

export interface TestAppHarness extends TestAppResult {
	server: Server;
	close: () => Promise<void>;
}

/** server.close only invokes the callback with an error when the socket was
 * never bound — which can't happen below because we always reach here after
 * listen(0). Treat the callback as completion regardless of the err arg so
 * coverage doesn't carry a phantom reject branch.
 *
 * closeAllConnections() is called first to immediately destroy keep-alive
 * sockets. Without it, server.close() waits for sockets to drain naturally,
 * which can outlast jest's worker shutdown timeout and cause force-exits that
 * truncate V8 coverage shards below the 99% threshold. */
function buildHarness(fixture: TestAppFixture): TestAppHarness {
	const result = createTestApp(fixture);
	const server = result.app.listen(0);
	return {
		...result,
		server,
		close: () => new Promise<void>((resolve) => {
			server.closeAllConnections();
			server.close(() => resolve());
		}),
	};
}

/** Per-suite factory that registers an `afterEach` to close every harness it
 * creates. Call once at module scope (or describe scope) and use the returned
 * function inside `it()` to build a fresh test server — the cleanup is
 * transparent so tests don't have to thread `close()` through finally blocks
 * or hoist fixture creation into `beforeEach` just for lifecycle reasons. */
export function useTestServer(): (fixture: TestAppFixture) => TestAppHarness {
	const harnesses: TestAppHarness[] = [];
	afterEach(async () => {
		const toClose = harnesses.splice(0);
		await Promise.all(toClose.map((h) => h.close()));
	});
	return (fixture) => {
		const harness = buildHarness(fixture);
		harnesses.push(harness);
		return harness;
	};
}

export async function loginAgent(
	server: Server,
	auth: TestAppHarness["auth"],
) {
	await auth.createUser({ email: "test@example.com", password: "password123" });
	const agent = request.agent(server);
	await agent
		.post("/login")
		.type("form")
		.send({ email: "test@example.com", password: "password123" });
	return agent;
}
