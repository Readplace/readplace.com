import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { ArticleMetadata, Minutes, ValidateSaveableUrl } from "@packages/domain/article";
import type {
	FindRelatedArticles,
	MarkRelatedArticlesReady,
	MarkRelatedArticlesSkipped,
} from "@packages/provider-contracts/related-articles";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxEmailStore,
	InboxSavedLinkStore,
} from "@packages/domain/inbox";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import type { ParseArticle } from "@packages/article-parser";
import type {
	ArticleCrawlVersion,
	BotDefenseEvent,
	BumpArticleSavedAt,
	CheckoutPaymentStatus,
	CheckoutSessionId,
	ConsumePendingSignup,
	ConsumeRateLimit,
	ContentProvider,
	ConversionEvent,
	CountArticlesByUser,
	CountUsers,
	CreateAppleUser,
	CreateChargeReminderSchedule,
	CreateCheckoutSession,
	CreateDeferredCancellationSchedule,
	CreateGoogleUser,
	CreatePasswordResetToken,
	CreateSession,
	CreateSubscriptionOnExistingCustomer,
	CreateTrialEndSchedule,
	CreateTrialFeedbackEmailSchedule,
	CreateTrialReminderSchedule,
	CreateUser,
	CreateUserWithPasswordHash,
	CreateVerificationToken,
	DeleteArticle,
	DeleteAllUserArticles,
	DeleteChargeReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
	DeleteTrialReminderSchedule,
	DestroySession,
	DestroyUserSessions,
	EmailMessage,
	ExchangeAppleCode,
	ExchangeGoogleCode,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlStatus,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindAppleRefreshTokenByUserId,
	FindArticleUrlById,
	FindArticlesByUser,
	FindEmailByUserId,
	FindGeneratedSummary,
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	FindSubscriptionNextCharge,
	FindUserArticleNotificationState,
	FindUserArticlesByUrl,
	FindUserByEmail,
	FindUserById,
	FindUserIdsByPrefix,
	ForceMarkCrawlPending,
	GetIosAppSignals,
	GetSessionUserId,
	InMemoryMarkCrawlFailed,
	InMemoryMarkCrawlReady,
	InMemoryMarkCrawlStage,
	InMemoryMarkCrawlUnsupported,
	ListUserArticleUrls,
	MarkArticleViewed,
	MarkCrawlPending,
	MarkEmailVerified,
	MarkReaderReadyEmailSent,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	MarkSessionEmailVerified,
	MarkSubscriptionActive,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	MarkSummaryPending,
	OAuthModel,
	RevokeAllUserOAuthTokens,
	FindOAuthClient,
	RegisterOAuthClient,
	ValidateOAuthRedirectUri,
	BeginAddCard,
	CardSetupId,
	GetCardSetupResult,
	ListCards,
	RemoveCard,
	SavedCard,
	SetPrimaryCard,
	PublishCancelSubscriptionCommand,
	PublishDeleteAccountCommand,
	PublishExportUserDataCommand,
	PublishLinkDequeued,
	PublishComputeRelatedArticles,
	PublishLinkQueued,
	PublishLinkSaved,
	PublishRecrawlLinkInitiated,
	PublishRemoveMyContent,
	PublishSaveAnonymousLink,
	PublishSaveLinkRawHtmlCommand,
	PublishSaveLinkRawPdfCommand,
	PublishStaleCheckRequested,
	PublishSubscriptionReactivated,
	PublishUpdateFetchTimestamp,
	PutPendingHtml,
	PutPendingPdf,
	CreateUploadSlot,
	StatPendingUpload,
	ReadPendingUploadPrefix,
	RateLimitRules,
	ReadArticleContent,
	RecordIosAnyActivity,
	RecordIosSavedArticle,
	RefreshArticleIfStale,
	RetrieveCheckoutSession,
	ReverseScheduledCancellation,
	SaveAppleRefreshToken,
	SaveArticle,
	SaveArticleGlobally,
	ScheduleCancellationAtPeriodEnd,
	SetSubscriptionNextCharge,
	SubscriptionNextCharge,
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
	createAppleUser: CreateAppleUser;
	saveAppleRefreshToken: SaveAppleRefreshToken;
	findAppleRefreshTokenByUserId: FindAppleRefreshTokenByUserId;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	destroySession: DestroySession;
	destroyUserSessions: DestroyUserSessions;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	userExistsByEmail: UserExistsByEmail;
	findUserIdsByPrefix: FindUserIdsByPrefix;
	updatePassword: UpdatePassword;
	findEmailByUserId: FindEmailByUserId;
	findUserById: FindUserById;
	deleteUser: (email: string) => Promise<void>;
	getAcquisitionAttribution: (email: string) => Promise<UserAcquisitionAttribution | undefined>;
}

export interface HostedCheckoutBundle {
	createCheckoutSession: CreateCheckoutSession;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	markPaid: (id: CheckoutSessionId, opts?: { paymentStatus?: CheckoutPaymentStatus }) => void;
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
	setNextCharge: SetSubscriptionNextCharge;
	seedRow: (row: SubscriptionRecord) => void;
}

export interface TrialSchedulerBundle {
	createTrialEndSchedule: CreateTrialEndSchedule;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	createDeferredCancellationSchedule: CreateDeferredCancellationSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createTrialFeedbackEmailSchedule: CreateTrialFeedbackEmailSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
	getTrialFeedbackEmailSchedule: (userId: UserId) => string | undefined;
	trialFeedbackEmailDeleteCalls: () => readonly UserId[];
	createTrialReminderSchedule: CreateTrialReminderSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	getSchedule: (userId: UserId) => string | undefined;
	allSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deleteCalls: () => readonly UserId[];
	getDeferredCancellationSchedule: (userId: UserId) => string | undefined;
	allDeferredCancellationSchedules: () => readonly { userId: UserId; firesAt: string }[];
	deferredCancellationDeleteCalls: () => readonly UserId[];
	getTrialReminderSchedule: (userId: UserId) => string | undefined;
	allTrialReminderSchedules: () => readonly { userId: UserId; firesAt: string }[];
	trialReminderDeleteCalls: () => readonly UserId[];
	createChargeReminderSchedule: CreateChargeReminderSchedule;
	deleteChargeReminderSchedule: DeleteChargeReminderSchedule;
	getChargeReminderSchedule: (
		userId: UserId,
	) => { firesAt: string; chargeAt: string } | undefined;
	allChargeReminderSchedules: () => readonly {
		userId: UserId;
		firesAt: string;
		chargeAt: string;
	}[];
	chargeReminderDeleteCalls: () => readonly UserId[];
}

export interface PaymentMethodsBundle {
	listCards: ListCards;
	beginAddCard: BeginAddCard;
	getCardSetupResult: GetCardSetupResult;
	removeCard: RemoveCard;
	setPrimaryCard: SetPrimaryCard;
	seedCards: (input: { customerId: string; cards: SavedCard[] }) => void;
	completeCardSetup: (input: { setupId: CardSetupId; card: SavedCard }) => void;
	failCardSetup: (input: { setupId: CardSetupId; reason?: string }) => void;
}

export interface SubscriptionBillingBundle {
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	findSubscriptionNextCharge: FindSubscriptionNextCharge;
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
	seedNextCharge: (input: { subscriptionId: string; nextCharge: SubscriptionNextCharge }) => void;
	failNextChargeLookup: () => void;
	nextChargeLookups: () => readonly string[];
}

export interface ArticleStoreBundle {
	deleteAllUserArticles: DeleteAllUserArticles;
	listUserArticleUrls: ListUserArticleUrls;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	bumpArticleSavedAt: BumpArticleSavedAt;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markRelatedDismissed: MarkRelatedDismissed;
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
	setContentFetchedAt: (params: { url: string; at: string }) => Promise<void>;
	setCrawlVersions: (params: { url: string; versions: ArticleCrawlVersion[] }) => Promise<void>;
	setPurgedAt: (params: { url: string; at: Date }) => Promise<void>;
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
	publishLinkQueued: PublishLinkQueued;
	publishLinkDequeued: PublishLinkDequeued;
	publishComputeRelatedArticles: PublishComputeRelatedArticles;
	publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated;
	publishRemoveMyContent: PublishRemoveMyContent;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	publishExportUserDataCommand: PublishExportUserDataCommand;
	publishDeleteAccountCommand: PublishDeleteAccountCommand;
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

export interface PendingUploadBundle {
	createUploadSlot: CreateUploadSlot;
	statPendingUpload: StatPendingUpload;
	readPendingUploadPrefix: ReadPendingUploadPrefix;
	stageUploaded: (params: { url: string; mediaType: string; bytes: Buffer; stagedAt?: Date }) => void;
	receiveUpload: (key: string, bytes: Buffer) => void;
}

export interface SummaryBundle {
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
}

export interface RelatedArticlesBundle {
	findRelatedArticles: FindRelatedArticles;
	markRelatedArticlesReady: MarkRelatedArticlesReady;
	markRelatedArticlesSkipped: MarkRelatedArticlesSkipped;
}

export interface FreshnessBundle {
	refreshArticleIfStale: RefreshArticleIfStale;
}

export interface OAuthBundle {
	oauthModel: OAuthModel;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
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

export interface AppleAuthBundle {
	exchangeAppleCode: ExchangeAppleCode;
	clientId: string;
	stateSigningSecret: string;
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
	inboxEmailLinkStore: InboxEmailLinkStore;
	inboxSavedLinkStore: InboxSavedLinkStore;
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
	publishedComputeRelatedArticles: { url: string; userId: UserId }[];
	pendingHtml: PendingHtmlBundle;
	pendingPdf: PendingPdfBundle;
	pendingUpload: PendingUploadBundle;
	summary: SummaryBundle;
	relatedArticles: RelatedArticlesBundle;
	freshness: FreshnessBundle;
	oauth: OAuthBundle;
	email: EmailBundle;
	emailVerification: EmailVerificationBundle;
	passwordReset: PasswordResetBundle;
	rateLimit: RateLimitBundle;
	iosOnboardingSignal: IosOnboardingSignalBundle;
	google: GoogleAuthBundle | undefined;
	apple: AppleAuthBundle;
	admin: AdminBundle;
	importSession: ImportSessionBundle;
	inboxAddress: InboxAddressBundle;
	inboxEmail: InboxEmailBundle;
	shared: SharedBundle;
	hostedCheckout: HostedCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	subscriptionProviders: SubscriptionProvidersBundle;
	trialScheduler: TrialSchedulerBundle;
	subscriptionBilling: SubscriptionBillingBundle;
	paymentMethods: PaymentMethodsBundle;
	stripePriceId: string;
	/** Public Stripe publishable key embedded in the card-add Elements form.
	 * `undefined` models local dev without a key — the page then renders the
	 * list/remove/promote actions but not the add form. */
	stripePublishableKey: string | undefined;
	botDefense: BotDefenseBundle;
	conversions: ConversionsBundle;
	foundingAllocation: FoundingAllocationBundle;
}
