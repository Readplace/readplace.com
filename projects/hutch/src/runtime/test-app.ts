import type { Express } from "express";
import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ParseArticle } from "./providers/article-parser/article-parser.types";
import type { PublishLinkSaved } from "./providers/events/publish-link-saved.types";
import type { PublishRecrawlLinkInitiated } from "./providers/events/publish-recrawl-link-initiated.types";
import type { PublishSaveAnonymousLink } from "./providers/events/publish-save-anonymous-link.types";
import type { PublishSaveLinkRawHtmlCommand } from "./providers/events/publish-save-link-raw-html-command.types";
import type { PublishUpdateFetchTimestamp } from "./providers/events/publish-update-fetch-timestamp.types";
import type { PutPendingHtml } from "./providers/pending-html/pending-html.types";
import type {
	FindGeneratedSummary,
	ForceMarkSummaryPending,
	MarkSummaryPending,
} from "./providers/article-summary/article-summary.types";
import type {
	FindArticleCrawlStatus,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "./providers/article-crawl/article-crawl.types";
import type {
	InMemoryMarkCrawlFailed,
	InMemoryMarkCrawlReady,
	InMemoryMarkCrawlStage,
} from "./providers/article-crawl/in-memory-article-crawl";
import type { RefreshArticleIfStale } from "./providers/article-freshness/check-content-freshness";
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
} from "./providers/auth/auth.types";
import type { PublishExportUserDataCommand } from "./providers/events/publish-export-user-data-command.types";
import type {
	CheckoutSessionId,
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "./providers/stripe-checkout/stripe-checkout.types";
import type {
	ConsumePendingSignup,
	StorePendingSignup,
} from "./providers/pending-signup/pending-signup.types";
import type {
	ArticleMetadata,
	Minutes,
} from "./domain/article/article.types";
import type {
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleFreshness,
	FindArticlesByUser,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "./providers/article-store/article-store.types";
import type {
	ContentProvider,
	ReadArticleContent,
} from "./providers/article-store/read-article-content";
import type { SendEmail, EmailMessage } from "./providers/email/email.types";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "./providers/email-verification/email-verification.types";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "./providers/password-reset/password-reset.types";
import type { ExchangeGoogleCode } from "./providers/google-auth/google-token.types";
import type { OAuthModel } from "./providers/oauth/oauth-model";
import type { ValidateAccessToken } from "./web/dual-auth.middleware";
import type { ImportSessionStore } from "./domain/import-session/import-session.types";
import type { InMemoryOnboarding } from "./providers/onboarding/in-memory-onboarding";
import { createApp } from "./server";
import type { HttpErrorMessageMapping } from "./web/pages/queue/queue.error";

export interface AuthBundle {
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
	updatePassword: UpdatePassword;
	findEmailByUserId: FindEmailByUserId;
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

export interface ArticleStoreBundle {
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
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
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishExportUserDataCommand: PublishExportUserDataCommand;
}

export interface PendingHtmlBundle {
	putPendingHtml: PutPendingHtml;
	readPendingHtml: (url: string) => string | undefined;
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
	appOrigin: string;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	logError: (message: string, error?: Error) => void;
	logParseError: LogParseError;
	now: () => Date;
}

export interface ImportSessionBundle {
	importSessionStore: ImportSessionStore;
}

export interface OnboardingBundle {
	onboarding: InMemoryOnboarding;
}

export interface BotDefenseBundle {
	logger: HutchLogger.Typed<BotDefenseEvent>;
	events: BotDefenseEvent[];
}

export interface TestAppFixture {
	auth: AuthBundle;
	articleStore: ArticleStoreBundle;
	articleCrawl: ArticleCrawlBundle;
	parser: ParserBundle;
	events: EventsBundle;
	pendingHtml: PendingHtmlBundle;
	summary: SummaryBundle;
	freshness: FreshnessBundle;
	oauth: OAuthBundle;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	google: GoogleAuthBundle | undefined;
	admin: AdminBundle;
	importSession: ImportSessionBundle;
	onboarding: OnboardingBundle;
	shared: SharedBundle;
	stripe: StripeCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	botDefense: BotDefenseBundle;
}

export interface TestAppResult {
	onboarding: InMemoryOnboarding;
	app: Express;
	auth: AuthBundle;
	articleStore: ArticleStoreBundle;
	articleCrawl: ArticleCrawlBundle;
	pendingHtml: PendingHtmlBundle;
	oauthModel: OAuthModel;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	stripe: StripeCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	botDefense: BotDefenseBundle;
}

function flattenFixtureToAppDependencies(
	fixture: TestAppFixture,
): Parameters<typeof createApp>[0] {
	return {
		appOrigin: fixture.shared.appOrigin,
		staticBaseUrl: "",
		baseUrl: fixture.shared.appOrigin,
		logError: fixture.shared.logError,
		logParseError: fixture.shared.logParseError,
		httpErrorMessageMapping: fixture.shared.httpErrorMessageMapping,
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
		updatePassword: fixture.auth.updatePassword,
		findEmailByUserId: fixture.auth.findEmailByUserId,
		findArticleById: fixture.articleStore.findArticleById,
		findArticleByUrl: fixture.articleStore.findArticleByUrl,
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
		publishSaveLinkRawHtmlCommand: fixture.events.publishSaveLinkRawHtmlCommand,
		publishUpdateFetchTimestamp: fixture.events.publishUpdateFetchTimestamp,
		publishExportUserDataCommand: fixture.events.publishExportUserDataCommand,
		putPendingHtml: fixture.pendingHtml.putPendingHtml,
		findGeneratedSummary: fixture.summary.findGeneratedSummary,
		markSummaryPending: fixture.summary.markSummaryPending,
		forceMarkSummaryPending: fixture.summary.forceMarkSummaryPending,
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
		findCompletedOnboardingSteps: fixture.onboarding.onboarding.findCompletedOnboardingSteps,
		markOnboardingStepCompleted: fixture.onboarding.onboarding.markOnboardingStepCompleted,
		now: fixture.shared.now,
		createCheckoutSession: fixture.stripe.createCheckoutSession,
		retrieveCheckoutSession: fixture.stripe.retrieveCheckoutSession,
		storePendingSignup: fixture.pendingSignup.storePendingSignup,
		consumePendingSignup: fixture.pendingSignup.consumePendingSignup,
		botDefenseLogger: fixture.botDefense.logger,
	};
}

export function createTestApp(fixture: TestAppFixture): TestAppResult {
	const app = createApp(flattenFixtureToAppDependencies(fixture));
	return {
		app,
		auth: fixture.auth,
		articleStore: fixture.articleStore,
		articleCrawl: fixture.articleCrawl,
		pendingHtml: fixture.pendingHtml,
		oauthModel: fixture.oauth.oauthModel,
		email: fixture.email,
		emailVerification: fixture.emailVerification,
		passwordReset: fixture.passwordReset,
		stripe: fixture.stripe,
		pendingSignup: fixture.pendingSignup,
		botDefense: fixture.botDefense,
		onboarding: fixture.onboarding.onboarding,
	};
}
