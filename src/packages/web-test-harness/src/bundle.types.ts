import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { ArticleMetadata, Minutes, ValidateSaveableUrl } from "@packages/domain/article";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { InboxAddressStore, InboxEmailStore } from "@packages/domain/inbox";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import type { ParseArticle } from "@packages/article-parser";
import type {
	BotDefenseEvent,
	BumpArticleSavedAt,
	CheckoutSessionId,
	ConsumePendingSignup,
	ConsumeRateLimit,
	ContentProvider,
	ConversionEvent,
	CountArticlesByUser,
	CountUsers,
	CreateCheckoutSession,
	CreateDeferredCancellationSchedule,
	CreateGoogleUser,
	CreatePasswordResetToken,
	CreateSession,
	CreateSubscriptionOnExistingCustomer,
	CreateTrialEndSchedule,
	CreateUser,
	CreateUserWithPasswordHash,
	CreateVerificationToken,
	DeleteArticle,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DestroySession,
	EmailMessage,
	ExchangeGoogleCode,
	ExistsUserByIdPrefix,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlStatus,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	FindEmailByUserId,
	FindGeneratedSummary,
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	FindUserArticleNotificationState,
	FindUserArticlesByUrl,
	FindUserByEmail,
	FindUserById,
	ForceMarkCrawlPending,
	GetIosAppSignals,
	GetSessionUserId,
	InMemoryMarkCrawlFailed,
	InMemoryMarkCrawlReady,
	InMemoryMarkCrawlStage,
	InMemoryMarkCrawlUnsupported,
	MarkArticleViewed,
	MarkCrawlPending,
	MarkEmailVerified,
	MarkReaderReadyEmailSent,
	MarkReaderViewSucceeded,
	MarkSummaryToggled,
	MarkSessionEmailVerified,
	MarkSubscriptionActive,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	MarkSummaryPending,
	OAuthModel,
	FindOAuthClient,
	RegisterOAuthClient,
	ValidateOAuthRedirectUri,
	PublishCancelSubscriptionCommand,
	PublishExportUserDataCommand,
	PublishLinkSaved,
	PublishRecrawlLinkInitiated,
	PublishSaveAnonymousLink,
	PublishSaveLinkRawHtmlCommand,
	PublishSaveLinkRawPdfCommand,
	PublishStaleCheckRequested,
	PublishSubscriptionReactivated,
	PublishUpdateFetchTimestamp,
	PutPendingHtml,
	PutPendingPdf,
	RateLimitRules,
	ReadArticleContent,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
	RefreshArticleIfStale,
	RetrieveCheckoutSession,
	ReverseScheduledCancellation,
	SaveArticle,
	SaveArticleGlobally,
	ScheduleCancellationAtPeriodEnd,
	SendEmail,
	StorePendingSignup,
	SubscriptionRecord,
	UpdateArticleStatus,
	UpdatePassword,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
	UserAcquisitionAttribution,
	UserExistsByEmail,
	ValidateAccessToken,
	VerifyCredentials,
	VerifyEmailToken,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts";
import type { UserId } from "@packages/domain/user";

export type { ValidateAccessToken };

export type HttpErrorMessageMapping = (
	query: Record<string, unknown>,
) => string | undefined;

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
	findUserById: FindUserById;
	deleteUser: (email: string) => Promise<void>;
	getAcquisitionAttribution: (email: string) => Promise<UserAcquisitionAttribution | undefined>;
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
	createdSubscriptions: () => readonly {
		customerId: string;
		priceId: string;
		userId: UserId;
		subscriptionId: string;
	}[];
	scheduledCancellations: () => readonly { subscriptionId: string; cancellationEffectiveAt: string }[];
	reversedCancellations: () => readonly string[];
}

export interface ArticleStoreBundle {
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticleFreshness: FindArticleFreshness;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	bumpArticleSavedAt: BumpArticleSavedAt;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markReaderViewSucceeded: MarkReaderViewSucceeded;
	findUserArticlesByUrl: FindUserArticlesByUrl;
	markReaderReadyEmailSent: MarkReaderReadyEmailSent;
	findUserArticleNotificationState: FindUserArticleNotificationState;
	getSummaryToggleState: (params: { userId: UserId; url: string }) => Promise<{
		lastSummaryOpenedAt?: Date;
		lastSummaryClosedAt?: Date;
	} | null>;
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
}

export interface FreshnessBundle {
	refreshArticleIfStale: RefreshArticleIfStale;
}

export interface OAuthBundle {
	oauthModel: OAuthModel;
	validateAccessToken: ValidateAccessToken;
	findClient: FindOAuthClient;
	validateRedirectUri: ValidateOAuthRedirectUri;
	registerClient: RegisterOAuthClient;
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

export interface RateLimitBundle {
	consumeRateLimit: ConsumeRateLimit;
	rules: RateLimitRules;
}

export interface IosOnboardingSignalBundle {
	recordIosAnyActivity: RecordIosAnyActivity;
	recordIosSavedArticle: RecordIosSavedArticle;
	getIosAppSignals: GetIosAppSignals;
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

export interface InboxAddressBundle {
	inboxAddressStore: InboxAddressStore;
	inboxAddressDomain: string;
}

export interface InboxEmailBundle {
	inboxEmailStore: InboxEmailStore;
	readEmailContent: ContentProvider;
}

export interface BotDefenseBundle {
	logger: HutchLogger.Typed<BotDefenseEvent>;
	events: BotDefenseEvent[];
}

export interface ConversionsBundle {
	logger: HutchLogger.Typed<ConversionEvent>;
	events: ConversionEvent[];
}

/** Holds the founding-member cap as a plain number. The application's
 * composition root builds the runtime predicate from this so this package
 * stays free of cross-project imports — same reason `httpErrorMessageMapping`
 * is a structural type defined here rather than an import of any
 * application's own declaration. */
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
	rateLimit: RateLimitBundle;
	iosOnboardingSignal: IosOnboardingSignalBundle;
	google: GoogleAuthBundle | undefined;
	admin: AdminBundle;
	importSession: ImportSessionBundle;
	inboxAddress: InboxAddressBundle;
	inboxEmail: InboxEmailBundle;
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
