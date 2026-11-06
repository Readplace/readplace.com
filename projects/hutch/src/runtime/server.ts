import type { RequestResolutionOnView } from "./domain/resolve-on-view/request-resolution-on-view";
import { initKeepOffer } from "./domain/engagement/keep-offer";
import { initRecordPersonalSaves } from "./domain/engagement/record-personal-saves";
import type { ActivationThresholdReachedEvent } from "./domain/engagement/funnel-events";
import { initEmitLifecycleEmailSent, type LifecycleEmailSentEvent } from "./observability/lifecycle-email-events";
import { initAuthDiagnosticRecorder } from "./auth-diagnostics/record";
import { initAuthDiagnosticMiddleware } from "./auth-diagnostics/middleware";
import { initIngestAuthDiagnostics } from "./auth-diagnostics/ingest";
import { initRecordImportRequest } from "./domain/engagement/record-import-request";
import { captureOAuthBody } from "./oauth-refresh/request-body";
import { refreshContext } from "./oauth-refresh/evidence";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import type { Express, NextFunction, Request, Response } from "express";
import express from "express";
import { isbot } from "isbot";
import { ignoreLogLine } from "./web/ignore-log-line";
import type { ClientNameInGroup } from "@packages/supported-clients";
import type {
	CountEarlyIntentionalSave,
	CountUsers,
	CreateAppleUser,
	CreateGoogleUser,
	CreateSession,
	CreateUser,
	CreateUserWithPasswordHash,
	DestroyOAuthGrantSessions,
	DestroySession,
	DestroyUserSessions,
	FindEmailByUserId,
	FindUserById,
	FindUserPasswordStatus,
	FindUserByEmail,
	GetSessionUserId,
	RenewSession,
	MarkEmailVerified,
	MarkSessionEmailVerified,
	FindSessionReadlistFilter,
	FindSessionOAuthGrant,
	SetSessionReadlistFilter,
	SaveAppleRefreshToken,
	MarkActivationThresholdReached,
	SetKeepOfferDismissed,
	SetQueueDigestOptOut,
	SetUserAppearance,
	SetUserDisplayName,
	UpdatePassword,
	MarkAccountDeleted,
	UserExistsByEmail,
	VerifyCredentials,
} from "@packages/provider-contracts/auth";
import type {
	CreateCheckoutSession,
	RetrieveCheckoutSession,
} from "@packages/provider-contracts/hosted-checkout";
import type {
	ConsumePendingSignup,
	StorePendingSignup,
} from "@packages/provider-contracts/pending-signup";
import type {
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	SetSubscriptionNextCharge,
	RecordFounderNote,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CreateChargeReminderSchedule,
	CreateTrialEndSchedule,
	CreateTrialNudgeSchedule,
	CreateTrialReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type {
	PublishCancelSubscriptionCommand,
	PublishDeleteAccountCommand,
	PublishSubscriptionReactivated,
} from "@packages/provider-contracts/events";
import type {
	CreateSubscriptionOnExistingCustomer,
	ResolvePriceId,
	FindSubscriptionNextCharge,
	ListInvoices,
	ReverseScheduledCancellation,
} from "@packages/provider-contracts/subscription-billing";
import type {
	BeginAddCard,
	GetCardSetupResult,
	ListCards,
	RemoveCard,
	SetPrimaryCard,
} from "@packages/provider-contracts/payment-methods";
import type { ExchangeGoogleCode } from "@packages/provider-contracts/google-auth";
import type { ExchangeAppleCode } from "@packages/provider-contracts/apple-auth";
import type {
	GetOnboardingSignals,
	RecordDeleteArticleAcknowledged,
	RecordEmailStepMarkedDone,
	RecordGmailStepDismissed,
	RecordMarkReadAcrossQueuesAcknowledged,
	RecordNativeAppAnyActivity,
	RecordNativeAppSavedArticle,
	RecordNextReadMinimumReached,
	RecordOnboardingOutstandingVersion,
} from "@packages/provider-contracts/onboarding-signals";
import type {
	AllocateSavedAt,
	AllocateSavedAtSequence,
	FindSavedUrls,
	CountArticlesByUser,
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindItemOwner,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesAcrossReadlists,
	FindArticlesByUser,
	MarkArticleViewed,
	FindReadlistArticles,
	CountReadlistArticles,
	FindReadlistArticleById,
	UpdateArticleStatusAcrossReadlists,
	DeleteReadlistArticle,
	MarkReadlistArticleViewed,
	AssignSavedArticleToReadlist,
	SaveReadlistArticle,
	MoveReadlistArticles,
	ListUserSavesForUrl,
	ListUserSavesForUrls,
	ListReadlistDefinitions,
	RenameReadlistDefinition,
	SetReadlistDefinitionPurpose,
	ClearReadlistDefinitionPurpose,
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	PurgeReadlistFitOverrides,
	ListReadlistFitOverrides,
	DeleteReadlistFitOverride,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	SaveArticle,
	SaveArticleGlobally,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { FindIdentityRow, PinContentSource, SavePrivateItem, ReadArticleContent, ReadArticleImage } from "@packages/provider-contracts/article-store";
import type { RefreshIdentifiedArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type {
	FindArticleCrawlStatus,
	FindArticleCrawlStatuses,
	ForceMarkCrawlPending,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummaries,
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import type {
	PublishComputeRelatedPastReads,
	PublishComputeRelatedPasses,
	PublishQueueEntryCreated,
	PublishLinkDequeued,
	PublishLinkQueued,
	PublishLinkSaved,
} from "@packages/provider-contracts/events";
import type {
	MarkRelatedPassesRequested,
	ReadRelatedPassRequestState,
	FindPastReads,
	FindRelatedArticles,
} from "@packages/provider-contracts/related-articles";
import type { PublishRecrawlLinkInitiated } from "@packages/provider-contracts/events";
import type { PublishRemoveMyContent } from "@packages/provider-contracts/events";
import type { PublishSaveAnonymousLink, PublishSubmitLink } from "@packages/provider-contracts/events";
import type { PublishStaleCheckRequested } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";
import type { PublishExportUserDataCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import type { PutPendingPdf } from "@packages/provider-contracts/pending-pdf";
import type {
	CreateUploadSlot,
	StatPendingUpload,
	ReadPendingUploadPrefix,
} from "@packages/provider-contracts/pending-upload";
import type { SendEmail } from "@packages/provider-contracts/email";
import type {
	CreateVerificationToken,
	VerifyEmailToken,
} from "@packages/provider-contracts/email-verification";
import type {
	CreatePasswordResetToken,
	VerifyPasswordResetToken,
} from "@packages/provider-contracts/password-reset";
import type {
	MintBrowserHandoffCode,
	RedeemBrowserHandoffCode,
} from "@packages/provider-contracts/browser-handoff";
import type {
	ConsumeRateLimit,
	RateLimitRules,
} from "@packages/provider-contracts/rate-limit";
import type {
	FindOAuthClient,
	ListUserOAuthClients,
	OAuthModel,
	RegisterOAuthClient,
	RevokeAllUserOAuthTokens,
	RevokeOtherUserOAuthGrants,
	RevokeUserOAuthClient,
	ValidateAccessToken,
	ValidateOAuthRedirectUri,
} from "@packages/provider-contracts/oauth";
import { Logger } from "@packages/logger";
import {
	type AnalyticsEvent,
	createClickAttributionMiddleware,
	initRecordAudienceEvent,
	type RecordUngatedEvent,
	createVisitorIdMiddleware,
	isHttpsOrigin,
	tagPageviewExperiment,
	utmValidationMiddleware,
} from "@packages/web-analytics";
import { viewerOf } from "@packages/viewer-identity";
import { initAuthRoutes } from "./web/auth/auth.page";
import { initResolveSignupClient } from "./web/auth/signup-client";
import { initSlideSession } from "./web/middleware/slide-session.middleware";
import { stampOfflineOwner } from "./web/middleware/stamp-offline-owner.middleware";
import type { BotDefenseEvent } from "./web/auth/auth.page";
import type { ConversionEvent } from "./conversions";
import type { SubscriptionLogEvent } from "./observability/subscription-events";
import { APPLE_TOUCH_ICON_PATH, CLIENT_DIST_MOUNT_PATH, OFFLINE_READER_WORKER_FILE, isStaticAssetRequestPath } from "./web/static-asset-paths";
import { canonicalizeViewLandingPath } from "./web/pages/view/view-path";
import { initGoogleAuthRoutes } from "./web/auth/google-auth.page";
import { initAppleAuthRoutes } from "./web/auth/apple-auth.page";
import { initResolveLogin } from "@packages/web-session";
import { initForgotPasswordRoutes } from "./web/auth/forgot-password.page";
import { initBrowserHandoffRoutes } from "./web/auth/browser-handoff.page";
import { initReadlistRoutes } from "./web/pages/readlist/readlist.page";
import { initUnrouteInboxesOnReadlistDelete } from "./domain/readlist/unroute-inboxes-on-readlist-delete";
import { READLIST_PATH } from "./web/pages/readlist/readlist.url";
import { initImportSessionRoutes } from "./web/pages/import/import.page";
import { initUploadRouter, UPLOAD_OUTCOME_HTML } from "./web/pages/upload/upload.page";
import { initCommitReceivedUpload } from "./web/pages/upload/commit-received-upload";
import { initStageGatesByCaller } from "./web/pages/upload/stage-gates-by-caller";
import { initSettleByCaller, initStageForReview } from "./web/pages/upload/stage-for-review";
import { initAnonymousUploadRoutes } from "./web/pages/upload/upload-review.page";
import { inspectionPollBudget } from "./web/pages/upload/inspection-poll-budget";
import { createRateLimitMiddleware } from "./web/middleware/rate-limit";
import { INSPECT_BOOK_TIMEOUT_SECONDS } from "@packages/infra-components";
import { BOOK, MEDIA_KINDS, type MediaKindName, type UploadId } from "@packages/media-contracts";
import type {
	ClaimMediaUpload,
	CreateAnyMediaUploadSession,
	CreateMediaUploadSession,
	FindMediaUploadByCapability,
	FindMediaUploadSession,
	HeadMediaPendingOriginal,
	MarkMediaUploadCommitted,
	MarkMediaUploadInspecting,
	MintMediaPendingPost,
	PresignEnclosure,
	PresignMediaImage,
	PublishMediaUploadCommitted,
	PublishMediaUploadStaged,
	ReadMediaPendingPrefix,
} from "@packages/domain";
import type { ImportSessionStore } from "@packages/domain/import-session";
import type { InboxAddressStore, InboxEmailLinkStore, InboxSavedLinkStore } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { ExtractLinksFromPageUrl } from "@packages/extract-links-from-page";
import type { HttpErrorMessageMapping } from "./web/pages/readlist/readlist.error";
import { initSaveRoutes } from "./web/pages/save/save.page";
import { type ValidateSaveableUrl, withNewSavePreparation, withPrivateItemRefusal } from "@packages/domain/article";
import { initViewRoutes } from "./web/pages/view/view.page";
import { initAdminRoutes } from "./web/pages/admin/admin.routes";
import { initExportRoutes } from "./web/pages/export/export.page";
import { initQueueDigestUnsubscribeRoutes } from "./web/pages/queue-digest-unsubscribe/queue-digest-unsubscribe.page";
import { initQueueDigestUnsubscribeToken } from "./domain/email/queue-digest-unsubscribe-token";
import { initQueueDigestMarkReadRoutes } from "./web/pages/queue-digest-mark-read/queue-digest-mark-read.page";
import { initQueueDigestMarkReadToken } from "./domain/email/queue-digest-mark-read-token";
import { initAccountRoutes } from "./web/pages/account/account.page";
import { initAccountPasswordRoutes } from "./web/pages/account/account-password.page";
import { ACCOUNT_PASSWORD_URL, ACCOUNT_PLANS_URL } from "./web/pages/account/account.url";
import { initAgentSkills } from "./web/agent-skills/agent-skills";
import { initMcpServer } from "./web/mcp/mcp-server";
import { mcpServerDependenciesFrom } from "./web/mcp/mcp.wiring";
import { readlistDependenciesFrom } from "./web/pages/readlist/readlist.wiring";
import { importSessionDependenciesFrom } from "./web/pages/import/import.wiring";
import { viewDependenciesFrom } from "./web/pages/view/view.wiring";
import { accountDependenciesFrom } from "./web/pages/account/account.wiring";
import { initResolveOwnedArticle } from "./web/mcp/article-lookup";
import { initResolveReadlistMembership } from "./web/mcp/readlist-membership";
import { initMcpReadlistOperations } from "./web/mcp/readlist-operations";
import { generateReadlistSlug } from "@packages/domain/readlist";
import { initMcpRoutes } from "./web/mcp/mcp.routes";
import { buildMcpServerCard } from "./web/mcp/server-card";
import { MCP_RESOURCE_METADATA_PATH, MCP_RESOURCE_PATH } from "./web/mcp/protocol";
import { initResolveSaveAccess } from "./web/mcp/save-access";
import { initResolveToolAccess } from "./web/mcp/tool-access";
import { initAddArticleToReadlist, initFileArticleIntoReadlist, initUpsertReadlist, initSaveArticleAtReadlistTop, initSaveArticleFromUrl, type ResolveSaveIdentity, type ResolveWrapperTarget } from "@packages/save-article";
import type { FoundingAllocation } from "./web/shared/founding-progress/founding-allocation";
import { initDualAuth } from "./web/dual-auth.middleware";
import { initMarkdownBearerAuth } from "./web/markdown-bearer-auth.middleware";
import { initMarkExtensionInstalled } from "./web/mark-extension-installed.middleware";
import { initOAuthRoutes } from "./web/oauth/oauth.routes";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import { Base } from "./web/base.component";
import { initBuildBannerState } from "./web/banner-state";
import { initChangelogDismissRoute } from "./web/pages/banner/changelog-dismiss.route";
import {
	createCspNonceMiddleware,
	generateCspNonce,
	requireCspNonce,
	sendComponent,
	wantsMarkdown,
} from "@packages/web-shell";
import { wantsSiren } from "./web/content-negotiation";
import { setSirenDiscoveryRedirectCaching } from "./web/siren-discovery-cache";
import { contentSignalMiddleware } from "./web/content-signal.middleware";
import { createListingGenerationMiddleware } from "./web/listing-generation.middleware";
import { buildRobotsTxt } from "./web/robots-txt";
import { buildSiteWebmanifest } from "./web/site-webmanifest";
import { SLOGANS } from "./web/slogans";
import { linkHeaderMiddleware } from "./web/link-header.middleware";
import { readLastViewUrl } from "./web/last-view";
import {
	buildAgentAuthMetadata,
	buildProtectedResourceMetadata,
	PROTECTED_RESOURCE_METADATA_PATH,
	renderAuthMarkdown,
} from "./web/agent-auth";
import { buildHomepageArmBody } from "./web/pages/home";
import { resolveHomepageArm } from "./web/experiments/homepage-arm";
import { writeHomepageAssignment } from "./web/experiments/homepage-assignment";
import { campaignTag, HOMEPAGE_SPLIT } from "./web/experiments/homepage-split";
import { buildSaveTip } from "./web/shared/save-tip/save-tip.component";
import { initSaveTipEventRoute } from "./web/shared/save-tip/save-tip.route";
import { initPageDepthRoute } from "./web/shared/page-depth/page-depth.route";
import { McpConnectPage, parseMcpGuideOrigin } from "./web/pages/mcp";
import { DevelopersPage } from "./web/pages/developers";
import { PrivacyPage } from "./web/pages/privacy";
import { SupportPage } from "./web/pages/support";
import { TermsPage } from "./web/pages/terms";
import { HelpAddLinksPage } from "./web/pages/help";
import { UPLOAD_ENTRY_HREFS } from "./web/pages/upload/upload-entry-ctas";
import { isAppShell, nativeSurfaceOf } from "./web/onboarding/native-client";
import { APP_BACK_LINK } from "./web/shared/native-app-links";
import { initResolveMcpSaveProvenance } from "./web/shared/save-provenance";
import { E2EFixturePage } from "./web/pages/e2e-fixture";
import { createE2EFixturePdf } from "./web/pages/e2e-fixture-pdf";
import { initInstallRoutes, type FetchFirefoxDownloadUrl } from "./web/pages/install";
import { initIntegrationsRoutes } from "./web/pages/integrations";
import type { GmailIntegrationProviders } from "./web/pages/integrations/gmail-integration.types";
import type { ReadExcludedIdentities, RunLogsInsightsQuery } from "@packages/provider-contracts/logs-insights";
import { initMoveGmailMappingsOnReadlistDelete } from "./domain/gmail/move-gmail-mappings-on-readlist-delete";
import { initListConnectedOAuthClients } from "./domain/oauth/connected-oauth-clients";
import {
	type NewsletterCatalogSeed,
	initCatalogNewsletterDetector,
	initNewsletterDetectorChain,
} from "@packages/domain/newsletter-catalog";
import type { ReadNewsletterCatalog, WriteNewsletterCatalog } from "@packages/provider-contracts/newsletter-catalog";
import type { FindCanaryReport } from "@packages/provider-contracts/canary-report";
import { LANDING_PAGE_CONTENT, LandingPage, landingPageLastModified } from "./web/pages/landing-pages";
import type { LandingPageSlug } from "./web/pages/landing-pages";
import { NotFoundPage } from "./web/pages/not-found";
import { initGetEffectiveAccess } from "@packages/subscription-access";
import { initRequireWriteAccess } from "./web/middleware/require-write-access.middleware";
import { initResolveVerificationStatus } from "./web/middleware/resolve-verification-status.middleware";
import { requireNotLocked } from "./web/middleware/require-not-locked.middleware";
import { requireEnv, getEnv } from "@packages/require-env";
import "./web/session.types";

export const PORT = requireEnv("PORT");

export interface AppDependencies {
	readerSectionThresholdBytes: number;
	recordEngagementActivity: RecordEngagementActivity;
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	staticBaseUrl: string;
	hashPassword: (password: string) => Promise<string>;
	fetchFirefoxDownloadUrl: FetchFirefoxDownloadUrl;
	createUser: CreateUser;
	createUserWithPasswordHash: CreateUserWithPasswordHash;
	createGoogleUser: CreateGoogleUser;
	createAppleUser: CreateAppleUser;
	saveAppleRefreshToken: SaveAppleRefreshToken;
	findUserByEmail: FindUserByEmail;
	verifyCredentials: VerifyCredentials;
	createSession: CreateSession;
	getSessionUserId: GetSessionUserId;
	renewSession: RenewSession;
	destroySession: DestroySession;
	destroyUserSessions: DestroyUserSessions;
	destroyOAuthGrantSessions: DestroyOAuthGrantSessions;
	markAccountDeleted: MarkAccountDeleted;
	countUsers: CountUsers;
	markEmailVerified: MarkEmailVerified;
	markSessionEmailVerified: MarkSessionEmailVerified;
	setSessionReadlistFilter: SetSessionReadlistFilter;
	findSessionReadlistFilter: FindSessionReadlistFilter;
	findSessionOAuthGrant: FindSessionOAuthGrant;
	findUserById: FindUserById;
	countEarlyIntentionalSave: CountEarlyIntentionalSave;
	markActivationThresholdReached: MarkActivationThresholdReached;
	setKeepOfferDismissed: SetKeepOfferDismissed;
	keepOfferCouponId: string;
	keepOfferEndsAt: Date;
	findUserPasswordStatus: FindUserPasswordStatus;
	setUserAppearance: SetUserAppearance;
	setQueueDigestOptOut: SetQueueDigestOptOut;
	setUserDisplayName: SetUserDisplayName;
	googleAuth?: {
		exchangeGoogleCode: ExchangeGoogleCode;
		clientId: string;
		clientSecret: string;
	};
	/** Absent until the deployment carries the Gmail integration's own OAuth
	 * client, which is a separate Google Cloud project from sign-in: the
	 * gmail.settings.basic scope is restricted, and sharing the sign-in client
	 * would pull sign-in into that verification regime. */
	gmailIntegration?: GmailIntegrationProviders;
	readNewsletterCatalog: ReadNewsletterCatalog;
	writeNewsletterCatalog: WriteNewsletterCatalog;
	newsletterCatalogSeed: NewsletterCatalogSeed;
	findCanaryReport: FindCanaryReport;
	adminDashboards: {
		runLogsInsightsQuery: RunLogsInsightsQuery;
		readExcludedIdentities: ReadExcludedIdentities;
		now: () => Date;
	};
	appleAuth: {
		exchangeAppleCode: ExchangeAppleCode;
		clientId: string;
		stateSigningSecret: string;
	};
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findItemOwner: FindItemOwner;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	findArticleUrlById: FindArticleUrlById;
	findArticlesByUser: FindArticlesByUser;
	findArticlesAcrossReadlists: FindArticlesAcrossReadlists;
	countArticlesByUser: CountArticlesByUser;
	saveArticle: SaveArticle;
	saveArticleGlobally: SaveArticleGlobally;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	findReadlistArticleById: FindReadlistArticleById;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	deleteReadlistArticle: DeleteReadlistArticle;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
	listUserSavesForUrl: ListUserSavesForUrl;
	listUserSavesForUrls: ListUserSavesForUrls;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
	saveReadlistArticle: SaveReadlistArticle;
	moveReadlistArticles: MoveReadlistArticles;
	listReadlistDefinitions: ListReadlistDefinitions;
	renameReadlistDefinition: RenameReadlistDefinition;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
	createReadlistDefinition: CreateReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	purgeReadlistFitOverrides: PurgeReadlistFitOverrides;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	deleteReadlistFitOverride: DeleteReadlistFitOverride;
	markSummaryToggled: MarkSummaryToggled;
	markRelatedDismissed: MarkRelatedDismissed;
	sendEmail: SendEmail;
	createVerificationToken: CreateVerificationToken;
	verifyEmailToken: VerifyEmailToken;
	createPasswordResetToken: CreatePasswordResetToken;
	verifyPasswordResetToken: VerifyPasswordResetToken;
	mintBrowserHandoffCode: MintBrowserHandoffCode;
	redeemBrowserHandoffCode: RedeemBrowserHandoffCode;
	userExistsByEmail: UserExistsByEmail;
	updatePassword: UpdatePassword;
	baseUrl: string;
	logError: (message: string, error?: Error) => void;
	oauthModel: OAuthModel;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	revokeOtherUserOAuthGrants: RevokeOtherUserOAuthGrants;
	listUserOAuthClients: ListUserOAuthClients;
	revokeUserOAuthClient: RevokeUserOAuthClient;
	validateAccessToken: ValidateAccessToken;
	findOAuthClient: FindOAuthClient;
	validateOAuthRedirectUri: ValidateOAuthRedirectUri;
	registerOAuthClient: RegisterOAuthClient;
	publishLinkSaved: PublishLinkSaved;
	publishLinkQueued: PublishLinkQueued;
	publishLinkDequeued: PublishLinkDequeued;
	publishQueueEntryCreated: PublishQueueEntryCreated;
	publishComputeRelatedPastReads: PublishComputeRelatedPastReads;
	publishComputeRelatedPasses: PublishComputeRelatedPasses;
	requestResolutionOnView: RequestResolutionOnView;
	readRelatedPassRequestState: ReadRelatedPassRequestState;
	markRelatedPassesRequested: MarkRelatedPassesRequested;
	findRelatedArticles: FindRelatedArticles;
	findPastReads: FindPastReads;
	listIssueLinks: InboxEmailLinkStore["listLinksByEmail"];
	findIssueLink: InboxEmailLinkStore["getLink"];
	findIssueLinkSaveStates: InboxSavedLinkStore["findSavedLinks"];
	publishRecrawlLinkInitiated: PublishRecrawlLinkInitiated;
	publishRemoveMyContent: PublishRemoveMyContent;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishSubmitLink: PublishSubmitLink;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
	publishExportUserDataCommand: PublishExportUserDataCommand;
	publishDeleteAccountCommand: PublishDeleteAccountCommand;
	findEmailByUserId: FindEmailByUserId;
	putPendingHtml: PutPendingHtml;
	putPendingPdf: PutPendingPdf;
	createUploadSlot: CreateUploadSlot;
	statPendingUpload: StatPendingUpload;
	readPendingUploadPrefix: ReadPendingUploadPrefix;
	findGeneratedSummary: FindGeneratedSummary;
	findGeneratedSummaries: FindGeneratedSummaries;
	markSummaryPending: MarkSummaryPending;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findArticleCrawlStatuses: FindArticleCrawlStatuses;
	markCrawlPending: MarkCrawlPending;
	forceMarkCrawlPending: ForceMarkCrawlPending;
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
	refreshArticleIfStaleStored: RefreshIdentifiedArticleIfStale;
	allocateSavedAt: AllocateSavedAt;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	findSavedUrls: FindSavedUrls;
	saveArticleKeepingPosition: SaveArticle;
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	findIdentityRow: FindIdentityRow;
	resolveFirstVisitIdentity: ResolveSaveIdentity;
	resolveWrapperTarget: ResolveWrapperTarget;
	pinContentSource: PinContentSource;
	findContentSourceUrl: (url: string) => Promise<string | undefined>;
	getOnboardingSignals: GetOnboardingSignals;
	recordNativeAppAnyActivity: RecordNativeAppAnyActivity;
	recordNativeAppSavedArticle: RecordNativeAppSavedArticle;
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	recordEmailStepMarkedDone: RecordEmailStepMarkedDone;
	recordGmailStepDismissed: RecordGmailStepDismissed;
	recordOnboardingOutstandingVersion: RecordOnboardingOutstandingVersion;
	recordMarkReadAcrossQueuesAcknowledged: RecordMarkReadAcrossQueuesAcknowledged;
	recordDeleteArticleAcknowledged: RecordDeleteArticleAcknowledged;
	adminEmails: readonly string[];
	recrawlServiceToken: string;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	readArticleContent: ReadArticleContent;
	readArticleImage: ReadArticleImage;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	importSessionStore: ImportSessionStore;
	extractLinksFromPageUrl: ExtractLinksFromPageUrl;
	savePrivateItem: SavePrivateItem;
	createMediaUploadSession: CreateMediaUploadSession;
	findMediaUploadSession: FindMediaUploadSession;
	markMediaUploadCommitted: MarkMediaUploadCommitted;
	createAnyMediaUploadSession: CreateAnyMediaUploadSession;
	findMediaUploadByCapability: FindMediaUploadByCapability;
	markMediaUploadInspecting: MarkMediaUploadInspecting;
	claimMediaUpload: ClaimMediaUpload;
	publishMediaUploadStaged: PublishMediaUploadStaged;
	guestUploadKinds: readonly MediaKindName[];
	mintMediaPendingPost: MintMediaPendingPost;
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	readMediaPendingPrefix: ReadMediaPendingPrefix;
	presignMediaImage: PresignMediaImage;
	presignEnclosure: PresignEnclosure;
	publishMediaUploadCommitted: PublishMediaUploadCommitted;
	mintUploadId: () => UploadId;
	provisionInboxAddress: (userId: UserId) => Promise<void>;
	listInboxAddresses: InboxAddressStore["listAddressesByUserId"];
	setInboxAddressReadlist: InboxAddressStore["setAddressReadlist"];
	clearReadlistFromAddresses: InboxAddressStore["clearReadlistFromAddresses"];
	now: () => Date;
	drawRandomByte: () => number;
	retrieveCheckoutSession: RetrieveCheckoutSession;
	createCheckoutSession: CreateCheckoutSession;
	consumePendingSignup: ConsumePendingSignup;
	storePendingSignup: StorePendingSignup;
	publishCancelSubscriptionCommand: PublishCancelSubscriptionCommand;
	publishSubscriptionReactivated: PublishSubscriptionReactivated;
	subscriptionProviders: {
		upsertActive: UpsertActiveSubscription;
		recordFounderNote: RecordFounderNote;
		upsertTrialing: UpsertTrialingSubscription;
		findByUserId: FindSubscriptionByUserId;
		markActive: MarkSubscriptionActive;
		setNextCharge: SetSubscriptionNextCharge;
	};
	trialScheduler: {
		createTrialEndSchedule: CreateTrialEndSchedule;
		deleteTrialEndSchedule: DeleteTrialEndSchedule;
		deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
		deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
		createTrialReminderSchedule: CreateTrialReminderSchedule;
		deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
		createTrialNudgeSchedule: CreateTrialNudgeSchedule;
		createChargeReminderSchedule: CreateChargeReminderSchedule;
	};
	createSubscriptionOnExistingCustomer: CreateSubscriptionOnExistingCustomer;
	findSubscriptionNextCharge: FindSubscriptionNextCharge;
	listInvoices: ListInvoices;
	reverseScheduledCancellation: ReverseScheduledCancellation;
	paymentMethods: {
		listCards: ListCards;
		beginAddCard: BeginAddCard;
		getCardSetupResult: GetCardSetupResult;
		removeCard: RemoveCard;
		setPrimaryCard: SetPrimaryCard;
	};
	resolvePriceId: ResolvePriceId;
	stripePublishableKey: string | undefined;
	botDefenseLogger: Logger.Typed<BotDefenseEvent>;
	conversionLogger: Logger.Typed<ConversionEvent>;
	subscriptionLogger: Logger.Typed<SubscriptionLogEvent>;
	funnelLogger: Logger.Typed<ActivationThresholdReachedEvent | LifecycleEmailSentEvent>;
	analytics: Logger.Typed<AnalyticsEvent>;
	authDiagnosticsLogger: Logger.Typed<Record<string, unknown>>;
	salt: string;
	foundingAllocation: FoundingAllocation;
	consumeRateLimit: ConsumeRateLimit;
	rateLimitRules: RateLimitRules;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
	if (!req.userId) {
		res.redirect(303, `/login?return=${encodeURIComponent(req.originalUrl)}`);
		return;
	}
	next();
}

const LLMS_TXT = readFileSync(join(__dirname, "llms.txt"), "utf-8");
const LLMS_FULL_TXT = readFileSync(join(__dirname, "llms-full.txt"), "utf-8");
const OPENAI_APPS_CHALLENGE_TOKEN = "dfMZUMNhT2ApI31okvdB5BD1vdly8Ku5QRGcSLtDQ5k";
const LANDING_PAGE_SLUGS = Object.keys(LANDING_PAGE_CONTENT) as LandingPageSlug[];

export function createApp(dependencies: AppDependencies): Express {
	const {
		appOrigin,
		staticBaseUrl,
		getSessionUserId,
		countUsers,
		foundingAllocation,
		analytics,
		conversionLogger,
		subscriptionLogger,
		funnelLogger,
		...providers
	} = dependencies;
	const recordEngagementActivity: RecordEngagementActivity = async (input) => {
		try {
			await providers.recordEngagementActivity(input);
		} catch (error) {
			providers.logError("Failed to record engagement activity", error instanceof Error ? error : undefined);
		}
	};
	const deps = {
		...providers,
		recordEngagementActivity,
		...initRecordPersonalSaves({
			...providers,
			recordEngagementActivity,
			recordActivationThresholdReached: (event) => funnelLogger.info(event),
		}),
		importSessionStore: {
			...providers.importSessionStore,
			createImportSession: initRecordImportRequest({
				request: providers.importSessionStore.createImportSession,
				recordEngagementActivity,
				now: providers.now,
			}),
		},
	};
	const ownHost = new URL(appOrigin).hostname;
	const recordAnalyticsEvent = initRecordAudienceEvent({ logger: analytics });
	const recordConversionEvent = initRecordAudienceEvent({ logger: conversionLogger });
	const recordSubscriptionEvent = initRecordAudienceEvent({ logger: subscriptionLogger });
	const emitLifecycleEmailSent = initEmitLifecycleEmailSent({ logger: funnelLogger, now: providers.now });
	const recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent> = (event) => analytics.info(event);
	const app: Express = express();
	const authDiagnostics = initAuthDiagnosticRecorder({ salt: deps.salt, now: deps.now, logger: deps.authDiagnosticsLogger });
	app.use((req, _res, next) => refreshContext.run({ recoveryProof: req.get("X-Readplace-Refresh-Recovery") }, next));

	app.use(createCspNonceMiddleware({ generateCspNonce }));
	app.use(utmValidationMiddleware);

	app.use((req: Request, res: Response, next: NextFunction) => {
		if (viewerOf(req).host === "hutch-app.com") {
			res.redirect(301, `${appOrigin}${req.originalUrl}`);
			return;
		}
		next();
	});

	const agentSkills = initAgentSkills();

	const getEffectiveAccess = initGetEffectiveAccess({
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		now: deps.now,
	});

	const validateNewSaveUrl = withPrivateItemRefusal(withNewSavePreparation(deps.validateSaveableUrl));

	const resolveSaveAccess = initResolveSaveAccess({
		findUserById: deps.findUserById,
		now: deps.now,
	});
	const resolveToolAccess = initResolveToolAccess({ getEffectiveAccess, appOrigin });
	const resolveMcpSaveProvenance = initResolveMcpSaveProvenance({
		findOAuthClient: deps.findOAuthClient,
	});
	const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
		allocateSavedAt: deps.allocateSavedAt,
		saveArticleFromUrl: initSaveArticleFromUrl(deps),
	});

	const upsertReadlist = initUpsertReadlist({ ...deps, generateReadlistSlug });
	const gmailIntegration = deps.gmailIntegration === undefined
		? undefined
		: {
				...deps.gmailIntegration,
				gmailHistoryImportStore: {
					...deps.gmailIntegration.gmailHistoryImportStore,
					createJob: initRecordImportRequest({
						request: deps.gmailIntegration.gmailHistoryImportStore.createJob,
						recordEngagementActivity: deps.recordEngagementActivity,
						now: deps.now,
					}),
				},
				detectNewsletters: initNewsletterDetectorChain({
					detectors: [initCatalogNewsletterDetector({ readCatalog: deps.readNewsletterCatalog })],
				}),
				upsertReadlist,
				listReadlistDefinitions: deps.listReadlistDefinitions,
			};
	const unrouteInboxesOnReadlistDelete = initUnrouteInboxesOnReadlistDelete({
		deleteReadlistDefinition: deps.deleteReadlistDefinition,
		clearReadlistFromAddresses: deps.clearReadlistFromAddresses,
	});
	const deleteReadlistDefinition = gmailIntegration === undefined
		? unrouteInboxesOnReadlistDelete
		: initMoveGmailMappingsOnReadlistDelete({
				deleteReadlistDefinition: unrouteInboxesOnReadlistDelete,
				mappings: gmailIntegration.gmailMappingStore,
				connections: gmailIntegration.gmailConnectionStore,
				findReadlistAddress: gmailIntegration.findReadlistAddress,
				getOrCreateReadlistAddress: gmailIntegration.getOrCreateReadlistAddress,
				retireReadlistAddress: gmailIntegration.retireReadlistAddress,
				cancelGmailHistoryImports: gmailIntegration.cancelGmailHistoryImports,
				publishRewriteGmailFilter: gmailIntegration.publishRewriteGmailFilter,
			});
	const fileArticleIntoReadlist = initFileArticleIntoReadlist(deps);
	const addArticleToReadlist = initAddArticleToReadlist(deps);
	const resolveOwnedArticle = initResolveOwnedArticle(deps);
	const resolveReadlistMembership = initResolveReadlistMembership(deps);
	const readlistOperations = initMcpReadlistOperations({
		listReadlistDefinitions: deps.listReadlistDefinitions,
		upsertReadlist,
		addArticleToReadlist,
		resolveOwnedArticle,
		resolveReadlistMembership,
	});
	const mcpServer = initMcpServer(mcpServerDependenciesFrom(deps, {
		appOrigin,
		resolveToolAccess,
		readlistOperations,
		resolveSaveAccess,
		recordUngatedAnalyticsEvent,
		validateNewSaveUrl,
		resolveMcpSaveProvenance,
		saveArticleAtReadlistTop,
		fileArticleIntoReadlist,
		resolveReadlistMembership,
		resolveOwnedArticle,
	}));

	const secureCookies = isHttpsOrigin(appOrigin);

	app.use(express.urlencoded({ extended: true, verify: captureOAuthBody }));
	app.use(cookieParser());
	app.use(initAuthDiagnosticMiddleware({ diagnostics: authDiagnostics, now: deps.now, secureCookies }));
	app.use(
		createVisitorIdMiddleware({
			generateVisitorId: randomUUID,
			secure: secureCookies,
			isStaticAssetPath: isStaticAssetRequestPath,
		}),
	);
	app.use(
		createClickAttributionMiddleware({
			now: dependencies.now,
			secure: secureCookies,
			isStaticAssetPath: isStaticAssetRequestPath,
			canonicalizeLandingPath: canonicalizeViewLandingPath,
			ownHost,
		}),
	);
	app.use(
		createListingGenerationMiddleware({
			nextGeneration: randomUUID,
			secure: secureCookies,
		}),
	);

	// Same-origin client bundles — the Lambda packaging step copies
	// src/runtime/web/client-dist/ into the bundle, so `__dirname/web/client-dist`
	// resolves both in dev (tsx → src/runtime/) and in prod (Lambda → /var/task/).
	app.use(
		CLIENT_DIST_MOUNT_PATH,
		express.static(resolve(__dirname, "web", "client-dist"), {
			maxAge: "5m",
			fallthrough: false,
			setHeaders: (res, servedFile) => {
				if (basename(servedFile) !== OFFLINE_READER_WORKER_FILE) return;
				res.set({ "Service-Worker-Allowed": "/", "Cache-Control": "no-cache" });
			},
		}),
	);

	app.use(contentSignalMiddleware);
	app.use(linkHeaderMiddleware);

	const sessionLogger = Logger.from({
		info: ignoreLogLine,
		warn: ignoreLogLine,
		debug: ignoreLogLine,
		error: (...args) => deps.logError(String(args[0])),
	});
	const resolveLogin = initResolveLogin({ getSessionUserId, logger: sessionLogger });
	app.use(async (req: Request, _res: Response, next: NextFunction) => {
		const login = await resolveLogin(req.headers.cookie);
		if (login.isAuthenticated) {
			req.userId = login.userId;
			req.emailVerified = login.emailVerified;
			req.sessionExpiresAt = login.sessionExpiresAt;
		}
		next();
	});

	app.use(
		initSlideSession({
			renewSession: deps.renewSession,
			now: deps.now,
			logger: sessionLogger,
			secureCookies,
		}),
	);

	const resolveVerificationStatus = initResolveVerificationStatus({
		findUserById: deps.findUserById,
		markSessionEmailVerified: deps.markSessionEmailVerified,
		now: deps.now,
	});
	app.use(resolveVerificationStatus);

	const markExtensionInstalled = initMarkExtensionInstalled({ secureCookies });
	app.use(markExtensionInstalled);

	const requireWriteAccess = initRequireWriteAccess({
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		now: deps.now,
	});
	const buildBannerState = initBuildBannerState({
		getEffectiveAccess,
		findUserById: deps.findUserById,
	});

	app.get("/favicon.ico", (_req: Request, res: Response) => {
		res.redirect(301, `${staticBaseUrl}/favicon.ico`);
	});

	/** iOS Safari and other clients auto-fetch /apple-touch-icon[-NxN][-precomposed].png from the root before reading <link rel="apple-touch-icon"> in the HTML. Redirect every shape to the static CDN. */
	app.get(APPLE_TOUCH_ICON_PATH, (req: Request, res: Response) => {
		res.redirect(301, `${staticBaseUrl}${req.path}`);
	});

	app.get("/robots.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(buildRobotsTxt(dependencies.baseUrl));
	});

	app.get("/llms.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(LLMS_TXT);
	});

	app.get("/llms-full.txt", (_req: Request, res: Response) => {
		res.type("text/plain").send(LLMS_FULL_TXT);
	});

	app.get("/auth.md", (_req: Request, res: Response) => {
		res.type("text/markdown").send(renderAuthMarkdown(dependencies.baseUrl));
	});

	app.get("/site.webmanifest", (_req: Request, res: Response) => {
		res.type("application/manifest+json").send(buildSiteWebmanifest(staticBaseUrl));
	});

	/** Read by clients that render a slogan but cannot ship a new build to
	 * change one — the iOS login screen most of all, where the alternative is
	 * an App Store release. */
	app.get("/slogans", (_req: Request, res: Response) => {
		res.json({ slogans: SLOGANS });
	});

	app.get("/sitemap.xml", (_req: Request, res: Response) => {
		/** Blog URLs live in the blog's own sitemap at /blog/sitemap.xml
		 * (advertised in robots.txt), since the blog is a separate deployable. */
		const pages: { loc: string; priority: string; changefreq: string; lastmod: string }[] = [
			{ loc: "/", priority: "1.0", changefreq: "weekly", lastmod: "2026-10-01" },
			{ loc: "/install", priority: "0.8", changefreq: "monthly", lastmod: "2026-09-11" },
			{ loc: "/import", priority: "0.8", changefreq: "monthly", lastmod: "2026-10-13" },
			{ loc: "/mcp", priority: "0.8", changefreq: "monthly", lastmod: "2026-09-12" },
			...LANDING_PAGE_SLUGS.map((slug) => ({
				loc: `/${slug}`,
				priority: "0.6",
				changefreq: "monthly",
				lastmod: landingPageLastModified(LANDING_PAGE_CONTENT[slug]),
			})),
			{ loc: "/embed/", priority: "0.5", changefreq: "monthly", lastmod: "2026-09-24" },
			{ loc: "/login", priority: "0.5", changefreq: "yearly", lastmod: "2026-03-01" },
			{ loc: "/llms.txt", priority: "0.3", changefreq: "monthly", lastmod: "2026-10-01" },
			{ loc: "/llms-full.txt", priority: "0.3", changefreq: "monthly", lastmod: "2026-10-01" },
			{ loc: "/auth.md", priority: "0.3", changefreq: "monthly", lastmod: "2026-08-05" },
		];

		const urls = pages
			.map(
				(p) =>
					`  <url>\n    <loc>${dependencies.baseUrl}${p.loc}</loc>\n    <lastmod>${p.lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
			)
			.join("\n");
		res.type("application/xml").send(
			`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
		);
	});

	app.get("/health", (_req: Request, res: Response) => {
		res.json({ status: "ok" });
	});

	app.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
		res.set("Access-Control-Allow-Origin", "*");
		res.json({
			issuer: dependencies.baseUrl,
			authorization_endpoint: `${dependencies.baseUrl}/oauth/authorize`,
			token_endpoint: `${dependencies.baseUrl}/oauth/token`,
			readplace_refresh_protocols_supported: [1],
			readplace_refresh_enrollment_enabled: deps.oauthModel.refresh.enrollmentEnabled,
			readplace_auth_diagnostics_endpoint: `${dependencies.baseUrl}/diagnostics/auth`,
			registration_endpoint: `${dependencies.baseUrl}/oauth/register`,
			revocation_endpoint: `${dependencies.baseUrl}/oauth/revoke`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			token_endpoint_auth_methods_supported: ["none"],
			code_challenge_methods_supported: ["S256"],
			agent_auth: buildAgentAuthMetadata(dependencies.baseUrl),
		});
	});

	app.get(PROTECTED_RESOURCE_METADATA_PATH, (_req: Request, res: Response) => {
		res.json(
			buildProtectedResourceMetadata({
				baseUrl: dependencies.baseUrl,
				resource: dependencies.baseUrl,
			}),
		);
	});

	app.get(MCP_RESOURCE_METADATA_PATH, (_req: Request, res: Response) => {
		res.json(
			buildProtectedResourceMetadata({
				baseUrl: dependencies.baseUrl,
				resource: `${dependencies.baseUrl}${MCP_RESOURCE_PATH}`,
			}),
		);
	});

	app.get("/.well-known/api-catalog", (_req: Request, res: Response) => {
		res
			.set("Content-Type", 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"')
			.send(
				JSON.stringify(
					{
						linkset: [
							{
								anchor: dependencies.baseUrl,
								"service-doc": [{ href: `${dependencies.baseUrl}/llms-full.txt`, type: "text/plain" }],
								"service-meta": [
									{
										href: `${dependencies.baseUrl}${PROTECTED_RESOURCE_METADATA_PATH}`,
										type: "application/json",
									},
								],
								status: [{ href: `${dependencies.baseUrl}/health`, type: "application/json" }],
							},
						],
					},
					null,
					2,
				),
			);
	});

	app.get("/.well-known/agent-skills/index.json", (_req: Request, res: Response) => {
		res.json(agentSkills.buildIndex());
	});

	for (const skill of agentSkills.getAll()) {
		app.get(`/.well-known/agent-skills/${skill.name}/SKILL.md`, (_req: Request, res: Response) => {
			res.type("text/markdown; charset=utf-8").send(skill.content);
		});
	}

	app.get("/.well-known/mcp/server-card.json", (_req: Request, res: Response) => {
		res.json(buildMcpServerCard(dependencies.baseUrl));
	});

	app.get("/.well-known/openai-apps-challenge", (_req: Request, res: Response) => {
		res.type("text/plain; charset=utf-8").send(OPENAI_APPS_CHALLENGE_TOKEN);
	});

	app.get("/mcp", async (req: Request, res: Response, next: NextFunction) => {
		if ((req.headers.accept ?? "").includes("text/event-stream")) {
			next();
			return;
		}
		sendComponent(req, res, Base(McpConnectPage({ origin: parseMcpGuideOrigin(req.query) }), await buildBannerState(req)));
	});

	app.use(
		"/mcp",
		initMcpRoutes({
			validateAccessToken: deps.validateAccessToken,
			mcpServer,
			baseUrl: dependencies.baseUrl,
			recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
		}),
	);

	app.get("/developers", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(DevelopersPage(), await buildBannerState(req)));
	});

	const EXTENSION_ORIGIN_PATTERNS = {
		firefox: /^moz-extension:\/\//,
		chrome: /^chrome-extension:\/\//,
	} satisfies Record<ClientNameInGroup<"browserExtension">, RegExp>;
	const extensionOriginPattern = new RegExp(
		Object.values(EXTENSION_ORIGIN_PATTERNS)
			.map((pattern) => pattern.source)
			.join("|"),
	);
	const isAllowedExtensionOrigin = (origin: string | undefined): boolean =>
		!origin ||
		origin === appOrigin ||
		origin === "https://hutch-app.com" ||
		extensionOriginPattern.test(origin);

	const extensionCors = cors({
		origin: (origin, callback) => callback(null, isAllowedExtensionOrigin(origin)),
		methods: ["GET", "POST", "PUT", "DELETE"],
		allowedHeaders: ["Authorization", "Content-Type", "Accept", "Prefer", "DPoP", "X-Readplace-Auth-Attempt-Id", "X-Readplace-Auth-Context-Id", "X-Readplace-Client-Version", "X-Readplace-Installation-Id"],
		exposedHeaders: ["DPoP-Nonce", "X-Readplace-Refresh-Attempt"],
		maxAge: 86400,
	});
	app.options("/diagnostics/auth", extensionCors);
	app.post("/diagnostics/auth", extensionCors, express.json({ limit: "32kb" }), initIngestAuthDiagnostics({
		verifyPermit: authDiagnostics.permits.verify,
		consumeRateLimit: deps.consumeRateLimit,
		record: authDiagnostics.write,
		now: deps.now,
	}));

	/** The session-cookie bridge is the only extension endpoint that needs
	 * credentialed CORS: the extension POSTs with credentials:"include" so the
	 * browser stores the Set-Cookie hutch_sid. credentials:true (which also
	 * reflects the specific Origin instead of "*") stays scoped to this route
	 * rather than loosening the bearer-only endpoints. */
	const sessionBridgeCors = cors({
		origin: (origin, callback) => callback(null, isAllowedExtensionOrigin(origin)),
		methods: ["POST"],
		allowedHeaders: ["Authorization", "Content-Type", "X-Readplace-Auth-Attempt-Id", "X-Readplace-Auth-Context-Id", "X-Readplace-Client-Version", "X-Readplace-Installation-Id"],
		credentials: true,
		maxAge: 86400,
	});

	/** Firefox extensions enforce CORS preflight for fetches with non-simple headers (Accept: application/vnd.siren+json, Authorization). Register OPTIONS so the preflight succeeds; without this it returns 404 and firefox aborts the fetch with NetworkError. */
	app.options("/", extensionCors);
	app.get("/", extensionCors, async (req: Request, res: Response) => {
		const sirenDiscovery = wantsSiren(req) && !wantsMarkdown(req);
		if (sirenDiscovery) {
			setSirenDiscoveryRedirectCaching(res);
		}
		if (req.userId || sirenDiscovery) {
			res.redirect(303, READLIST_PATH);
			return;
		}

		const eligible = !isbot(req.get("user-agent")) && !wantsMarkdown(req);
		const arm = resolveHomepageArm({
			req,
			config: HOMEPAGE_SPLIT,
			eligible,
			drawRandomByte: deps.drawRandomByte,
		});
		if (arm.participating) {
			writeHomepageAssignment(res, { config: HOMEPAGE_SPLIT, variant: arm.variant, secure: secureCookies });
			tagPageviewExperiment(res, {
				experiment: campaignTag(HOMEPAGE_SPLIT),
				variant: arm.variant.slug,
			});
		}
		res.set("Cache-Control", "private, no-cache");

		const banner = await buildBannerState(req);
		sendComponent(
			req,
			res,
			Base(
				buildHomepageArmBody({
					staticBaseUrl,
					lastViewUrl: readLastViewUrl(req),
					saveTip: buildSaveTip(req, { kind: "article", mode: "advisory" }),
					variant: arm.variant.marker,
				}),
				banner,
			),
		);
	});

	// The arms of the retired homepage split were their own URLs, so they sit in
	// histories and bookmarks; `/` is the page they ever meant.
	for (const retiredArmPath of ["/landing-a", "/landing-b"]) {
		app.get(retiredArmPath, (_req: Request, res: Response) => {
			res.redirect(303, "/");
		});
	}

	for (const slug of LANDING_PAGE_SLUGS) {
		app.get(`/${slug}`, async (req: Request, res: Response) => {
			sendComponent(
				req,
				res,
				Base(LandingPage({ slug, staticBaseUrl }), await buildBannerState(req)),
			);
		});
	}

	app.get("/privacy", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(PrivacyPage(), await buildBannerState(req)));
	});

	app.get("/support", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(SupportPage(), await buildBannerState(req)));
	});

	app.get("/terms", async (req: Request, res: Response) => {
		sendComponent(req, res, Base(TermsPage(), await buildBannerState(req)));
	});

	// Bare (HtmlPage, not Base) so the iOS Share-help sheet can render it in a
	// WKWebView without site chrome; public like /privacy. The current iOS client
	// holds this path client-side; the /queue collection still advertises it via the
	// add-links-help rel so older installed clients resolve the help URL from there.
	// Either way the copy ships via a hutch deploy rather than an App Store review.
	//
	// The app sheet appends ?shell=app, which earns the same chromeless "← Back to
	// queue" deep link the account page renders — so both surfaces the sheet hosts
	// return to the native list identically. A browser visitor (no marker) keeps the
	// bare page, and an older store build that never sends the marker keeps the
	// native toolbar it already ships.
	app.get("/help/add-links", (req: Request, res: Response) => {
		const backLink = isAppShell(req)
			? { href: APP_BACK_LINK.topHref, label: APP_BACK_LINK.label }
			: undefined;
		sendComponent(
			req,
			res,
			HelpAddLinksPage({
				staticBaseUrl,
				backLink,
				upload: isAppShell(req)
					? undefined
					: { href: UPLOAD_ENTRY_HREFS.helpAddLinks, ceilingLabel: BOOK.ceilingLabel, guest: !req.userId },
				platform: nativeSurfaceOf(req),
				cspNonce: requireCspNonce(req),
			}),
		);
	});

	// Path-uniqued article fixture for staging e2e tests. The :id segment is
	// ignored — body is identical for every id — so tests pass a per-run unique
	// value to ensure each CI run targets a fresh article row instead of
	// inheriting whatever state the previous run left in DynamoDB. Gated off
	// when NODE_ENV is "production" so the route does not exist on the prod
	// Lambda; tests (NODE_ENV=test via Jest) and local dev (NODE_ENV unset)
	// both expose it.
	if (getEnv("NODE_ENV") !== "production") {
		app.get("/e2e/article/:id", async (req: Request, res: Response) => {
			const title = typeof req.query.title === "string" ? req.query.title : undefined;
			sendComponent(req, res, Base(E2EFixturePage({ title }), await buildBannerState(req)));
		});

		/**
		 * Path-uniqued PDF fixture for the extension's pdf-save-flow staging e2e.
		 * The `:id` segment is ignored — bytes are
		 * identical for every id — so callers pass `randomUUID()` to ensure each
		 * CI run targets a fresh save row and the deferred OCR pipeline cannot
		 * brick a subsequent run with cached state. Same gating as
		 * /e2e/article/:id: present on staging (NODE_ENV=development) and dev,
		 * absent on the production Lambda.
		 */
		const E2E_FIXTURE_PDF = createE2EFixturePdf("READPLACE_E2E_PDF_FIXTURE");
		app.get("/e2e/fixtures/pdf/:id.pdf", (_req: Request, res: Response) => {
			res.type("application/pdf").send(E2E_FIXTURE_PDF);
		});

		/** Deterministic newsletter-style page for the /import paste-a-link
		 * e2e flow. Same gating as the article fixture: present on staging and
		 * dev, absent on the production Lambda. The `:label` segment lets tests
		 * inject per-run-unique links so concurrent CI runs don't collide on
		 * the same harvested URL set. */
		app.get("/e2e/fixtures/links-page/:label", (req: Request, res: Response) => {
			const label = String(req.params.label).replace(/[^a-zA-Z0-9-]/g, "");
			const anchors = [1, 2, 3]
				.map(
					(i) =>
						`<a href="${appOrigin}/privacy?import-from-url-${label}-${i}">Article ${i}</a>`,
				)
				.join("\n");
			res
				.type("text/html")
				.send(
					`<!doctype html><html><head><title>Test newsletter ${label}</title></head><body><nav><a href="/subscribe">Subscribe</a></nav>${anchors}</body></html>`,
				);
		});

		app.get("/e2e/fixtures/links-page-empty", (_req: Request, res: Response) => {
			res
				.type("text/html")
				.send("<!doctype html><html><body><p>No outbound links here.</p></body></html>");
		});

		app.get("/e2e/fixtures/links-page-error", (_req: Request, res: Response) => {
			res.status(500).type("text/html").send("<html><body>boom</body></html>");
		});

		app.get("/e2e/fixtures/unfetchable/:id", (_req: Request, res: Response) => {
			res.status(404).type("text/plain").send("e2e: intentional crawl failure");
		});
	}

	app.use(
		initInstallRoutes({
			buildBannerState,
			staticBaseUrl,
			fetchFirefoxDownloadUrl: dependencies.fetchFirefoxDownloadUrl,
		}),
	);

	/** Same-origin dismissal endpoint for the site-wide changelog banner; served
	 * here on $default even when the close button is clicked on a /blog page. */
	app.use(initChangelogDismissRoute({ secureCookies }));
	app.use(initSaveTipEventRoute());
	app.use(initPageDepthRoute({ recordAnalyticsEvent, now: deps.now, salt: deps.salt }));

	/** Every account-creation path (password, trial, checkout, Google) funnels
	 * its user creation through these two deps, so wrapping them here provisions
	 * exactly one forwarding address per new account at the single composition
	 * seam. Best-effort: a failure is logged for alerting but never blocks
	 * signup — the inbox page's "Create Inbox Email" CTA is the recovery path. */
	const provisionInboxAddressOnSignup = async (userId: UserId): Promise<void> => {
		try {
			await deps.provisionInboxAddress(userId);
		} catch (error) {
			deps.logError(
				"[Inbox] Failed to provision a forwarding address at signup",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	};
	const createUserWithPasswordHash: CreateUserWithPasswordHash = async (input) => {
		const result = await deps.createUserWithPasswordHash(input);
		if (result.ok) await provisionInboxAddressOnSignup(result.userId);
		return result;
	};
	const createGoogleUser: CreateGoogleUser = async (input) => {
		const result = await deps.createGoogleUser(input);
		if (result.ok) await provisionInboxAddressOnSignup(result.userId);
		return result;
	};
	const createAppleUser: CreateAppleUser = async (input) => {
		const result = await deps.createAppleUser(input);
		if (result.ok) await provisionInboxAddressOnSignup(result.userId);
		return result;
	};

	const resolveSignupClient = initResolveSignupClient({ findOAuthClient: deps.findOAuthClient });
	const signUnsubscribeToken = initQueueDigestUnsubscribeToken(deps.salt).sign;

	const authRouter = initAuthRoutes({
		findSubscriptionByUserId: deps.subscriptionProviders.findByUserId,
		emitLifecycleEmailSent,
		resolveSignupClient,
		signUnsubscribeToken,
		findUserById: deps.findUserById,
		hashPassword: deps.hashPassword,
		createUserWithPasswordHash,
		findUserByEmail: deps.findUserByEmail,
		verifyCredentials: deps.verifyCredentials,
		validateAccessToken: deps.validateAccessToken,
		createSession: deps.createSession,
		renewSession: deps.renewSession,
		destroySession: deps.destroySession,
		countUsers,
		markEmailVerified: deps.markEmailVerified,
		markSessionEmailVerified: deps.markSessionEmailVerified,
		sendEmail: deps.sendEmail,
		createVerificationToken: deps.createVerificationToken,
		verifyEmailToken: deps.verifyEmailToken,
		retrieveCheckoutSession: deps.retrieveCheckoutSession,
		consumePendingSignup: deps.consumePendingSignup,
		subscriptionProviders: {
			upsertActive: deps.subscriptionProviders.upsertActive,
			upsertTrialing: deps.subscriptionProviders.upsertTrialing,
		},
		trialScheduler: deps.trialScheduler,
		baseUrl: deps.baseUrl,
		staticBaseUrl,
		secureCookies,
		logError: deps.logError,
		now: deps.now,
		botDefenseLogger: deps.botDefenseLogger,
		recordConversionEvent,
		recordAnalyticsEvent,
		salt: deps.salt,
		recordSubscriptionEvent,
		foundingAllocation,
		buildBannerState,
		consumeRateLimit: deps.consumeRateLimit,
		rateLimitRules: {
			login: deps.rateLimitRules.login,
			loginAccount: deps.rateLimitRules.loginAccount,
			signup: deps.rateLimitRules.signup,
		},
	});
	app.use("/auth/session", sessionBridgeCors);
	app.use(authRouter);
	app.use(
		initBrowserHandoffRoutes({
			validateAccessToken: deps.validateAccessToken,
			mintBrowserHandoffCode: deps.mintBrowserHandoffCode,
			redeemBrowserHandoffCode: deps.redeemBrowserHandoffCode,
			createSession: deps.createSession,
			renewSession: deps.renewSession,
			secureCookies,
			consumeRateLimit: deps.consumeRateLimit,
			rateLimitRule: deps.rateLimitRules.browserHandoff,
		}),
	);

	if (deps.googleAuth) {
		const googleAuthRouter = initGoogleAuthRoutes({
			emitLifecycleEmailSent,
			resolveSignupClient,
			signUnsubscribeToken,
			googleClientId: deps.googleAuth.clientId,
			googleClientSecret: deps.googleAuth.clientSecret,
			appOrigin,
			baseUrl: deps.baseUrl,
			staticBaseUrl,
			secureCookies,
			createSession: deps.createSession,
			createGoogleUser,
			findUserByEmail: deps.findUserByEmail,
			countUsers,
			markEmailVerified: deps.markEmailVerified,
			exchangeGoogleCode: deps.googleAuth.exchangeGoogleCode,
			upsertTrialing: deps.subscriptionProviders.upsertTrialing,
			trialScheduler: deps.trialScheduler,
			sendEmail: deps.sendEmail,
			logError: deps.logError,
			now: deps.now,
			recordConversionEvent,
			recordAnalyticsEvent,
			salt: deps.salt,
			foundingAllocation,
		});
		app.use(googleAuthRouter);
	}

	const appleAuthRouter = initAppleAuthRoutes({
		emitLifecycleEmailSent,
		resolveSignupClient,
		signUnsubscribeToken,
		appleClientId: deps.appleAuth.clientId,
		stateSigningSecret: deps.appleAuth.stateSigningSecret,
		appOrigin,
		baseUrl: deps.baseUrl,
		staticBaseUrl,
		secureCookies,
		createSession: deps.createSession,
		createAppleUser,
		saveAppleRefreshToken: deps.saveAppleRefreshToken,
		findUserByEmail: deps.findUserByEmail,
		countUsers,
		markEmailVerified: deps.markEmailVerified,
		exchangeAppleCode: deps.appleAuth.exchangeAppleCode,
		upsertTrialing: deps.subscriptionProviders.upsertTrialing,
		trialScheduler: deps.trialScheduler,
		sendEmail: deps.sendEmail,
		logError: deps.logError,
		now: deps.now,
		recordConversionEvent,
		recordAnalyticsEvent,
		salt: deps.salt,
		foundingAllocation,
	});
	app.use(appleAuthRouter);

	const forgotPasswordRouter = initForgotPasswordRoutes({
		revokeAllUserOAuthTokens: deps.revokeAllUserOAuthTokens,
		sendEmail: deps.sendEmail,
		userExistsByEmail: deps.userExistsByEmail,
		findUserByEmail: deps.findUserByEmail,
		updatePassword: deps.updatePassword,
		destroyUserSessions: deps.destroyUserSessions,
		createPasswordResetToken: deps.createPasswordResetToken,
		verifyPasswordResetToken: deps.verifyPasswordResetToken,
		baseUrl: deps.baseUrl,
		logError: deps.logError,
		consumeRateLimit: deps.consumeRateLimit,
		rateLimitRule: deps.rateLimitRules.forgotPassword,
		now: deps.now,
	});
	app.use(forgotPasswordRouter);

	const dualAuthMiddleware = initDualAuth({
		validateAccessToken: deps.validateAccessToken,
		baseUrl: deps.baseUrl,
	});
	const markdownBearerAuth = initMarkdownBearerAuth({
		validateAccessToken: deps.validateAccessToken,
	});
	const readerProvenanceNewsletters = initCatalogNewsletterDetector({ readCatalog: deps.readNewsletterCatalog });

	const keepOffer = initKeepOffer({ findUserById: deps.findUserById, getEffectiveAccess, now: deps.now, endsAt: deps.keepOfferEndsAt });

	const queueRouter = initReadlistRoutes(readlistDependenciesFrom(deps, {
		keepOffer,
		validateNewSaveUrl,
		appOrigin,
		secureCookies,
		saveArticleWithoutActivity: providers.saveArticle,
		addArticleToReadlist,
		fileArticleIntoReadlist,
		upsertReadlist,
		deleteReadlistDefinition,
		readerProvenanceNewsletters,
		gmailIntegration,
		dualAuthMiddleware,
		markdownBearerAuth,
		resolveOwnedArticle,
		resolveVerificationStatus,
		requireWriteAccess,
		getEffectiveAccess,
		buildBannerState,
		recordAnalyticsEvent,
		recordUngatedAnalyticsEvent,
	}));
	/** `dualAuthMiddleware` is applied INSIDE the queue router rather than at this
	 * mount so that `GET /queue/:id/view` (and its legacy `/read` redirect) can
	 * stay publicly reachable. Shared reader permalinks (people copy them from
	 * the browser URL bar) redirect non-owners and anonymous visitors to
	 * `/view/<url>` instead of bouncing them to /login. */
	app.use(READLIST_PATH, stampOfflineOwner, extensionCors, queueRouter);

	const importRouter = initImportSessionRoutes(importSessionDependenciesFrom(deps, {
		validateNewSaveUrl,
		secureCookies,
		saveArticleWithoutActivity: providers.saveArticle,
		recordAnalyticsEvent,
		recordUngatedAnalyticsEvent,
		buildBannerState,
		requireNotLocked,
		requireWriteAccess,
	}));
	/** Public on purpose: a logged-out visitor can upload, review, and toggle a
	 * selection before being asked to sign up. Auth is enforced only at commit
	 * (the sole content-creating route), where `redirectAnonymousToSignup` and the
	 * `requireNotLocked`/`requireWriteAccess` gates run as route middleware. */
	app.use("/import", importRouter);

	const commitReceivedUpload = initCommitReceivedUpload({
		savePrivateItem: deps.savePrivateItem,
		publishMediaUploadCommitted: deps.publishMediaUploadCommitted,
		markMediaUploadCommitted: deps.markMediaUploadCommitted,
		now: deps.now,
	});
	app.use(
		"/upload",
		initAnonymousUploadRoutes({
			findMediaUploadByCapability: deps.findMediaUploadByCapability,
			claimMediaUpload: deps.claimMediaUpload,
			commitReceivedUpload,
			requireNotLocked,
			requireWriteAccess,
			GUEST_UPLOAD_KINDS: deps.guestUploadKinds,
			MEDIA_KINDS,
			maxPolls: inspectionPollBudget({ lambdaTimeoutSeconds: INSPECT_BOOK_TIMEOUT_SECONDS, marginSeconds: 30 }),
			buildBannerState,
		}),
	);
	app.use(
		"/upload",
		initUploadRouter({
			stageGates: [
				initStageGatesByCaller({
					signedIn: [requireNotLocked, requireWriteAccess],
					guest: [
						createRateLimitMiddleware({
							consumeRateLimit: deps.consumeRateLimit,
							bucket: "upload-stage",
							rule: deps.rateLimitRules.uploadStage,
						}),
					],
				}),
			],
			settleReceivedUpload: initSettleByCaller({
				commitReceivedUpload,
				stageForReview: initStageForReview({
					markMediaUploadInspecting: deps.markMediaUploadInspecting,
					publishMediaUploadStaged: deps.publishMediaUploadStaged,
					MEDIA_KINDS,
					now: deps.now,
				}),
			}),
			createMediaUploadSession: deps.createAnyMediaUploadSession,
			findMediaUploadSession: deps.findMediaUploadByCapability,
			mintMediaPendingPost: deps.mintMediaPendingPost,
			headMediaPendingOriginal: deps.headMediaPendingOriginal,
			readMediaPendingPrefix: deps.readMediaPendingPrefix,
			mintUploadId: deps.mintUploadId,
			MEDIA_KINDS,
			pickOutcomeWriters: () => UPLOAD_OUTCOME_HTML,
			buildBannerState,
			appOrigin,
		}),
	);

	const saveRouter = initSaveRoutes({ buildBannerState, recordAnalyticsEvent, salt: deps.salt, now: deps.now, secureCookies, generatePendingSaveId: randomUUID, ownHost });
	app.use("/save", saveRouter);

	const viewRouter = initViewRoutes(viewDependenciesFrom(deps, {
		appOrigin,
		ownHost,
		secureCookies,
		buildBannerState,
		recordAnalyticsEvent,
	}));
	app.use("/view", viewRouter);

	app.use(initAdminRoutes(deps, { appOrigin, buildBannerState, emitLifecycleEmailSent }));

	const exportRouter = initExportRoutes({
		publishExportUserDataCommand: deps.publishExportUserDataCommand,
		findEmailByUserId: deps.findEmailByUserId,
		logError: deps.logError,
		now: () => new Date(),
		buildBannerState,
	});
	app.use("/export", requireAuth, exportRouter);

	app.use(
		initQueueDigestUnsubscribeRoutes({
			verifyUnsubscribeToken: initQueueDigestUnsubscribeToken(deps.salt).verify,
			setQueueDigestOptOut: deps.setQueueDigestOptOut,
			recordUngatedAnalyticsEvent,
			now: deps.now,
			buildBannerState,
		}),
	);

	app.use(
		initQueueDigestMarkReadRoutes({
			verifyMarkReadToken: initQueueDigestMarkReadToken(deps.salt).verify,
			updateArticleStatusAcrossReadlists: deps.updateArticleStatusAcrossReadlists,
			findArticleById: deps.findArticleById,
			findReadlistArticleById: deps.findReadlistArticleById,
			listReadlistDefinitions: deps.listReadlistDefinitions,
			buildBannerState,
		}),
	);

	const listConnectedOAuthClients = initListConnectedOAuthClients({
		listUserOAuthClients: deps.listUserOAuthClients,
		findOAuthClient: deps.findOAuthClient,
	});

	const accountRouter = initAccountRoutes(accountDependenciesFrom(deps, {
		keepOffer,
		getEffectiveAccess,
		listConnectedOAuthClients,
		appOrigin,
		buildBannerState,
		recordSubscriptionEvent,
		recordAnalyticsEvent,
	}));
	const accountPasswordRouter = initAccountPasswordRoutes({
		findUserById: deps.findUserById,
		findUserPasswordStatus: deps.findUserPasswordStatus,
		verifyCredentials: deps.verifyCredentials,
		consumeRateLimit: deps.consumeRateLimit,
		loginAccountRule: deps.rateLimitRules.loginAccount,
		updatePassword: deps.updatePassword,
		destroyUserSessions: deps.destroyUserSessions,
		findSessionOAuthGrant: deps.findSessionOAuthGrant,
		revokeOtherUserOAuthGrants: deps.revokeOtherUserOAuthGrants,
		createSession: deps.createSession,
		secureCookies,
		now: deps.now,
		buildBannerState,
	});
	app.use(ACCOUNT_PASSWORD_URL, accountPasswordRouter);
	app.get(ACCOUNT_PLANS_URL, (req: Request, res: Response, next: NextFunction) => {
		if (req.userId) {
			next();
			return;
		}
		res.redirect(303, `/login?return=${encodeURIComponent(req.originalUrl)}`);
	});
	app.use("/account", requireAuth, accountRouter);

	const integrationsRoutes = initIntegrationsRoutes({
		buildBannerState,
		requireAuth,
		requireNotLocked,
		requireWriteAccess,
		getEffectiveAccess,
		appOrigin,
		secureCookies,
		logError: deps.logError,
		now: deps.now,
		gmail: gmailIntegration,
		listInboxAddresses: deps.listInboxAddresses,
		listConnectedOAuthClients,
	});
	app.use("/newsletters", integrationsRoutes.newsletters);
	app.use(integrationsRoutes.gmailCallback);

	const oauthRouter = initOAuthRoutes({
		baseUrl: dependencies.baseUrl,
		model: deps.oauthModel,
		buildBannerState,
		findClient: deps.findOAuthClient,
		validateRedirectUri: deps.validateOAuthRedirectUri,
		registerClient: deps.registerOAuthClient,
		destroySession: deps.destroySession,
		destroyOAuthGrantSessions: deps.destroyOAuthGrantSessions,
		findEmailByUserId: deps.findEmailByUserId,
		consumeRateLimit: deps.consumeRateLimit,
		registerRateLimitRule: deps.rateLimitRules.oauthRegister,
		tokenRateLimitRule: deps.rateLimitRules.oauthToken,
		recordUngatedAnalyticsEvent,
		now: deps.now,
		salt: deps.salt,
	});
	app.use("/oauth/token", extensionCors);
	app.use("/oauth/revoke", extensionCors);
	app.use("/oauth", oauthRouter);

	app.use(async (req: Request, res: Response) => {
		sendComponent(req, res, Base(NotFoundPage(), await buildBannerState(req)));
	});

	return app;
}
