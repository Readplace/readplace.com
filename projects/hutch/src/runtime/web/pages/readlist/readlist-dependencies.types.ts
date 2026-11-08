import type { CanSaveContent } from "../../middleware/can-save-content";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import type { PresignEnclosure, PresignMediaImage } from "@packages/domain";
import type { initKeepOffer } from "../../../domain/engagement/keep-offer";
import type { RequestHandler, } from "express";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxSavedLinkStore,
} from "@packages/domain/inbox";
import type {
	ResolveReaderProvenance,
	ResolveReaderProvenances,
} from "../../shared/article-body/article-header/resolve-reader-provenance";
import type { AnalyticsEvent, RecordAudienceEvent, RecordUngatedEvent } from "@packages/web-analytics";
import type { RefreshIdentifiedArticleIfStale, } from "@packages/provider-contracts/article-freshness";
import type {
	AllocateSavedAt,
	AllocateSavedAtSequence,
	CountArticlesByUser,
	CountReadlistArticles,
	DeleteReadlistDefinition,
	PurgeReadlistFitOverrides,
	ListReadlistFitOverrides,
	DeleteReadlistFitOverride,
	DeleteArticle,
	DeleteReadlistArticle,
	PurgeReadlistArticle,
	FindArticleById,
	FindArticleByUrl,
	FindItemOwner,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	FindReadlistArticleById,
	FindReadlistArticles,
	MoveReadlistArticles,
	FindSavedUrls,
	ListReadlistDefinitions,
	RenameReadlistDefinition,
	SetReadlistDefinitionPurpose,
	ClearReadlistDefinitionPurpose,
	ListUserSavesForUrl,
	ListUserSavesForUrls,
	MarkArticleViewed,
	MarkReadlistArticleViewed,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	SaveArticle,
	UpdateArticleStatus,
	UpdateArticleStatusAcrossReadlists,
} from "@packages/provider-contracts/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type {
	DeleteArticleHighlights,
	DeleteHighlight,
	ListArticleHighlights,
	UpdateHighlightNote,
} from "@packages/provider-contracts/highlights";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { CreateReaderHighlight } from "../../shared/article-body/highlights/create-reader-highlight";
import type { PublishRemoveMyContent } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawPdfCommand, PublishSubmitLink } from "@packages/provider-contracts/events";
import type { PutPendingPdf } from "@packages/provider-contracts/pending-pdf";
import type {
	CreateUploadSlot,
	StatPendingUpload,
	ReadPendingUploadPrefix,
} from "@packages/provider-contracts/pending-upload";
import type { PinContentSource, ReadArticleContent, ReadArticleImage } from "@packages/provider-contracts/article-store";
import type {
	FindSessionReadlistFilter,
	FindUserById,
	SetSessionReadlistFilter,
	SetKeepOfferDismissed,
} from "@packages/provider-contracts/auth";
import type {
	FindArticleCrawlStatus,
	FindArticleCrawlStatuses,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummaries,
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import type { RenderReaderActions } from "../../shared/article-body/reader-actions/reader-actions.component";
import type {
	PublishLinkDequeued,
	PublishLinkQueued,
	PublishLinkSaved,
} from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import type {
	AddArticleToReadlist,
	FileArticleIntoReadlist,
	UpsertReadlist,
	ResolveSaveIdentity,
} from "@packages/save-article";
import type { PublishQueueEntryCreated } from "@packages/provider-contracts/events";
import type { PublishComputeRelatedPastReads, PublishComputeRelatedPasses } from "@packages/provider-contracts/events";
import type { RequestResolutionOnView } from "../../../domain/resolve-on-view/request-resolution-on-view";
import type {
	MarkRelatedPassesRequested,
	ReadRelatedPassRequestState,
	FindPastReads,
	FindRelatedArticles,
} from "@packages/provider-contracts/related-articles";
import type { BuildBannerState } from "../../banner-state";
import type { ResolveOwnedArticle } from "../../mcp/article-lookup";
import type { HttpErrorMessageMapping, } from "./readlist.error";
import type { GmailIntegrationDependencies } from "../integrations/gmail-integration.types";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import type {
	GetOnboardingSignals,
	RecordDeleteArticleAcknowledged,
	RecordEmailStepMarkedDone,
	RecordGmailStepDismissed,
	RecordNativeAppAnyActivity,
	RecordNativeAppSavedArticle,
	RecordNextReadMinimumReached,
	RecordMarkReadAcrossQueuesAcknowledged,
	RecordOnboardingOutstandingVersion,
} from "@packages/provider-contracts/onboarding-signals";
import type { GetEffectiveAccess } from "@packages/subscription-access";

export interface ReadlistDependencies {
	readerSectionThresholdBytes: number;
	validateSaveableUrl: ValidateSaveableUrl;
	validateNewSaveUrl: ValidateSaveableUrl;
	appOrigin: string;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findItemOwner: FindItemOwner;
	presignMediaImage: PresignMediaImage;
	presignEnclosure: PresignEnclosure;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	findArticleUrlById: FindArticleUrlById;
	saveArticle: SaveArticle;
	saveArticleWithoutActivity: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	findReadlistArticleById: FindReadlistArticleById;
	updateArticleStatusAcrossReadlists: UpdateArticleStatusAcrossReadlists;
	deleteReadlistArticle: DeleteReadlistArticle;
	purgeReadlistArticle: PurgeReadlistArticle;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
	listUserSavesForUrl: ListUserSavesForUrl;
	listUserSavesForUrls: ListUserSavesForUrls;
	deleteArticleHighlights: DeleteArticleHighlights;
	listArticleHighlights: ListArticleHighlights;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	deleteHighlight: DeleteHighlight;
	updateHighlightNote: UpdateHighlightNote;
	createReaderHighlight: CreateReaderHighlight;
	addArticleToReadlist: AddArticleToReadlist;
	fileArticleIntoReadlist: FileArticleIntoReadlist;
	upsertReadlist: UpsertReadlist;
	moveReadlistArticles: MoveReadlistArticles;
	listReadlistDefinitions: ListReadlistDefinitions;
	renameReadlistDefinition: RenameReadlistDefinition;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	purgeReadlistFitOverrides: PurgeReadlistFitOverrides;
	listReadlistFitOverrides: ListReadlistFitOverrides;
	deleteReadlistFitOverride: DeleteReadlistFitOverride;
	listInboxAddresses: InboxAddressStore["listAddressesByUserId"];
	setInboxAddressReadlist: InboxAddressStore["setAddressReadlist"];
	markSummaryToggled: MarkSummaryToggled;
	recordEngagementActivity: RecordEngagementActivity;
	markRelatedDismissed: MarkRelatedDismissed;
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
	resolveReaderProvenance: ResolveReaderProvenance;
	resolveReaderProvenances: ResolveReaderProvenances;
	publishRemoveMyContent: PublishRemoveMyContent;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
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
	refreshArticleIfStale: RefreshIdentifiedArticleIfStale;
	refreshArticleIfStaleStored: RefreshIdentifiedArticleIfStale;
	publishSubmitLink: PublishSubmitLink;
	allocateSavedAt: AllocateSavedAt;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	findSavedUrls: FindSavedUrls;
	resolveSaveIdentity: ResolveSaveIdentity;
	pinContentSource: PinContentSource;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	readArticleContent: ReadArticleContent;
	readArticleImage: ReadArticleImage;
	resolveOwnedArticle: ResolveOwnedArticle;
	markdownBearerAuth: RequestHandler;
	webReader: RenderReaderActions;
	chromelessReader: RenderReaderActions;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	/** Reads the per-user onboarding signals for the `/queue` render: the iOS
	 * app's install/save state when the visitor is on an iPhone (where completion
	 * can't come from cookies because Safari can't see the app's cookie jar), and
	 * the account-scoped Next Read milestone on every device that has a client. */
	getOnboardingSignals: GetOnboardingSignals;
	/** Marks the user "installed" on the app whose authenticated request carries
	 * the client header — the cross-app-cookie-jar substitute for the extension's
	 * liveness cookie. */
	recordNativeAppAnyActivity: RecordNativeAppAnyActivity;
	/** Marks the user's first save from the app whose save request carries the
	 * client header — the substitute for the extension's save cookie. */
	recordNativeAppSavedArticle: RecordNativeAppSavedArticle;
	/** Stamps the account the first time its save count reaches the Next Read
	 * minimum, so the milestone survives the user later deleting back below it and
	 * so later renders skip the count query entirely. */
	recordNextReadMinimumReached: RecordNextReadMinimumReached;
	recordEmailStepMarkedDone: RecordEmailStepMarkedDone;
	recordGmailStepDismissed: RecordGmailStepDismissed;
	findGmailConnectionByUserId: GmailConnectionStore["findConnectionByUserId"] | undefined;
	gmail: GmailIntegrationDependencies | undefined;
	recordOnboardingOutstandingVersion: RecordOnboardingOutstandingVersion;
	recordMarkReadAcrossQueuesAcknowledged: RecordMarkReadAcrossQueuesAcknowledged;
	recordDeleteArticleAcknowledged: RecordDeleteArticleAcknowledged;
	/** Auth middleware applied to every readlist route except the public
	 * `GET /:id/read` permalink. Owned by the composition root so the same
	 * middleware applies to all other authenticated mounts. */
	dualAuth: RequestHandler;
	/** Re-resolves the verification/lock standing after `dualAuth` so bearer
	 * (extension/iOS) requests — which carry no session cookie and so are
	 * invisible to the global resolve step — are locked too. */
	resolveVerificationStatus: RequestHandler;
	/** 402-gates the save endpoints when a user's subscription is inactive
	 * (cancelled or trial-expired). Mounted only on save routes — list, view,
	 * mark-as-read, and delete remain reachable for read-only users. */
	requireWriteAccess: RequestHandler;
	canSaveContent: CanSaveContent;
	secureCookies: boolean;
	getEffectiveAccess: GetEffectiveAccess;
	findUserById: FindUserById;
	setSessionReadlistFilter: SetSessionReadlistFilter;
	findSessionReadlistFilter: FindSessionReadlistFilter;
	buildBannerState: BuildBannerState;
	logError: (message: string, error?: Error) => void;
	recordAnalyticsEvent: RecordAudienceEvent<AnalyticsEvent>;
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	keepOffer: ReturnType<typeof initKeepOffer>;
	setKeepOfferDismissed: SetKeepOfferDismissed;
}
