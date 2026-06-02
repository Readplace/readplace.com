import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { ArticleMetadata, Minutes, ValidateSaveableUrl } from "@packages/domain/article";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import type { BotDefenseEvent } from "./providers/auth/bot-defense.types";
import type { ConversionEvent } from "./providers/auth/conversion.types";
import type { ExchangeGoogleCode } from "./providers/google-auth/google-token.types";
import type { ParseArticle } from "@packages/article-parser";
import type {
	PublishLinkSaved,
	PublishRecrawlLinkInitiated,
	PublishSaveAnonymousLink,
	PublishSaveLinkRawHtmlCommand,
	PublishSaveLinkRawPdfCommand,
	PublishStaleCheckRequested,
	PublishSubscriptionReactivated,
	PublishUpdateFetchTimestamp,
	PublishExportUserDataCommand,
	PublishCancelSubscriptionCommand,
} from "./providers/events";
import type { PutPendingHtml } from "./providers/pending-html/pending-html.types";
import type { PutPendingPdf } from "./providers/pending-pdf/pending-pdf.types";
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
	InMemoryMarkCrawlUnsupported,
} from "./providers/article-crawl/in-memory-article-crawl";
import type {
	CountUsers,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroySession,
	ExistsUserByIdPrefix,
	FindEmailByUserId,
	FindUserByEmail,
	GetSessionUserId,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	UpdatePassword,
	UserExistsByEmail,
	VerifyCredentials,
} from "./providers/auth/auth.types";
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
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	MarkSubscriptionCancelled,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	SubscriptionRecord,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "./providers/subscription-providers/subscription-providers.types";
import type {
	CreateDeferredCancellationSchedule,
	CreateTrialEndSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
} from "./providers/trial-scheduler/trial-scheduler.types";
import type {
	CreateSubscriptionOnExistingCustomer,
	ReverseScheduledCancellation,
	ScheduleCancellationAtPeriodEnd,
} from "./providers/stripe-subscriptions/stripe-subscriptions.types";
import type { UserId } from "@packages/domain/user";
import type {
	BumpArticleSavedAt,
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleFreshness,
	FindArticleUrlById,
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
import type { OAuthModel } from "./providers/oauth/oauth-model";
import type { ValidateAccessToken } from "./providers/oauth/validate-access-token";

export type HttpErrorMessageMapping = (
	query: Record<string, unknown>,
) => string | undefined;

import type {
	RefreshArticleIfStale,
	ContentFreshnessResult,
} from "./providers/article-freshness/check-content-freshness";
export type { RefreshArticleIfStale, ContentFreshnessResult };

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
	seedRow: (row: SubscriptionRecord) => void;
}

export interface TrialSchedulerBundle {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	getSchedule: (userId: UserId) => string | undefined;
	allSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deleteCalls: () => readonly UserId[];
	getDeferredCancellationSchedule: (userId: UserId) => string | undefined;
	allDeferredCancellationSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deferredCancellationDeleteCalls: () => readonly UserId[];
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
	bumpArticleSavedAt: BumpArticleSavedAt;
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
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
	publishStaleCheckRequested: PublishStaleCheckRequested;
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
	extractLinksFromPageUrl: ExtractLinksFromPageUrl;
}

export interface BotDefenseBundle {
	logger: HutchLogger.Typed<BotDefenseEvent>;
	events: BotDefenseEvent[];
}

export interface ConversionsBundle {
	logger: HutchLogger.Typed<ConversionEvent>;
	events: ConversionEvent[];
}

/** Holds the founding-member cap as a plain number. The hutch composition
 * root builds the runtime predicate from this so this package stays free of
 * cross-project imports — same reason `httpErrorMessageMapping` is duplicated
 * inline in fixture.ts instead of imported from projects/hutch. */
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
