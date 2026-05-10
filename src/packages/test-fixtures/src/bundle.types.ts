import type { CrawlArticle } from "@packages/crawl-article";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { ArticleMetadata, Minutes } from "@packages/domain/article";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { BotDefenseEvent } from "./providers/auth/bot-defense.types";
import type { ExchangeGoogleCode } from "./providers/google-auth/google-token.types";
import type { ParseArticle } from "./providers/article-parser/article-parser.types";
import type {
	PublishLinkSaved,
	PublishRecrawlLinkInitiated,
	PublishSaveAnonymousLink,
	PublishSaveLinkRawHtmlCommand,
	PublishStaleCheckRequested,
	PublishUpdateFetchTimestamp,
	PublishExportUserDataCommand,
} from "./providers/events";
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
	publishStaleCheckRequested: PublishStaleCheckRequested;
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
	shared: SharedBundle;
	stripe: StripeCheckoutBundle;
	pendingSignup: PendingSignupBundle;
	botDefense: BotDefenseBundle;
}
