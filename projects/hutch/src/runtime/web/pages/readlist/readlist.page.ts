import assert from "node:assert";
import {
	DISMISS_COOKIE_NAME,
	EXTENSION_LIVENESS_TTL_MS,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { BulkSaveOutcome, SaveableUrl, SaveableUrlErrorCode, ValidateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { BulkSaveManifestSchema, MAX_PAGES_PER_BULK_SAVE, MAX_UPLOAD_REQUEST_BYTES, ArticleStatusSchema, saveableUrlErrorMessage } from "@packages/domain/article";
import { buildSaveIntentEvent, classifyDeviceClass, hashIp, tagPageviewSortOrder, type AnalyticsEvent, type RecordAudienceEvent, type RecordUngatedEvent } from "@packages/web-analytics";
import { viewerOf } from "@packages/viewer-identity";
import { ANALYTICS_EVENTS, SAVE_OUTCOMES, SAVE_SURFACES, STREAMS, type SaveOutcome, type SaveSurface } from "../../../observability/events";
import { saveClientOf } from "../../shared/save-client";
import {
	IMPORT_SKIPPED_COOKIE_NAME,
	decodeImportSkippedCookie,
} from "../import/import-skipped-cookie";
import type { ImportSkippedViewModel } from "./readlist.viewmodel";
import { ReaderArticleHashIdSchema, calculateReadTime, isNonArticleHost, nextReadDismissalOf } from "@packages/domain/article";
import { NEXT_READ_MINIMUM_SAVES, hasEnoughSavesForNextRead } from "@packages/domain/article";
import type { ContentFreshnessResult, RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type {
	AllocateSavedAt,
	AllocateSavedAtSequence,
	CountArticlesByUser,
	CountReadlistArticles,
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	DeleteArticle,
	DeleteReadlistArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	FindArticlesResult,
	FindReadlistArticleById,
	FindReadlistArticles,
	AssignSavedArticleToReadlist,
	MoveReadlistArticles,
	FindSavedUrls,
	ListReadlistDefinitions,
	RenameReadlistDefinition,
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
import type { PublishRemoveMyContent } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";
import type { PutPendingPdf } from "@packages/provider-contracts/pending-pdf";
import type {
	CreateUploadSlot,
	StatPendingUpload,
	ReadPendingUploadPrefix,
} from "@packages/provider-contracts/pending-upload";
import { isPDF, MAX_HTML_BYTES, MAX_PDF_BYTES } from "@packages/crawl-article";
import { initMultipartUpload } from "../import/multipart-upload";
import { UPLOAD_COMPLETION_MAX_AGE_SECONDS } from "./upload-slot-ttl";
import { initSaveContentLimitHandler } from "./save-content-limit-handler";
import { initSaveArticlesLimitHandler } from "./save-articles-limit-handler";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { FindUserById } from "@packages/provider-contracts/auth";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	FindArticleCrawlStatuses,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummaries,
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type { RenderReaderActions } from "../../shared/article-body/reader-actions/reader-actions.component";
import type { PollUrlBuilder, ReaderViewFailedOob } from "../../shared/article-reader/article-reader.types";
import {
	epubDownloadHref as buildEpubDownloadHref,
	revealsEpubDownload,
} from "../../shared/epub/epub-link";
import type {
	PublishLinkDequeued,
	PublishLinkQueued,
	PublishLinkSaved,
} from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import {
	initDeleteArticleFromReadlist,
	initPublishLinkDequeuedUnlessSavedElsewhere,
	initSaveArticleAtReadlistTop, initSaveArticleFromUrl,
	rankNewLinksAbove,
} from "@packages/save-article";
import type { PublishQueueEntryCreated } from "@packages/provider-contracts/events";
import type {
	FindRelatedArticles,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import { Base, ChromelessPage } from "../../base.component";
import { NotFoundPage } from "../not-found";
import type { BuildBannerState } from "../../banner-state";
import { selectChangelogBanner } from "../../banner-state";
import type { GetChangelogBanner } from "../../changelog-banner-source";
import { requireCspNonce, sendComponent, withInternalTracking } from "@packages/web-shell";
import type { CspNonce } from "@packages/web-shell";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { initObserveSaveRefusal, tagSaveRefusal } from "../../shared/save-refusal";
import { SAVE_REFUSAL_CODES } from "@packages/web-analytics";
import { RedirectComponent, type Redirect } from "../../redirect.component";
import { CacheableComponent, FreshForComponent } from "../../conditional-get";
import {
	NO_READER_VIEW_FAILED_OOB,
	extensionSuggestionBannerOob,
} from "../../shared/article-reader/reader-view-failed-oob";
import { buildSaveTip } from "../../shared/save-tip/save-tip.component";
import { markSaveTipSeen } from "../../shared/save-tip/save-tip";
import { initReaderPermalink } from "./reader-permalink";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { toBulkSaveResultEntity } from "../../api/bulk-save-siren";
import { toSavedArticleEntity } from "../../api/article-siren";
import { toUploadSlotEntity } from "../../api/upload-slot-siren";
import {
	parseReadlistUrl,
	buildReadlistUrl,
	READLIST_PATH,
	READLIST_CREATE_PATH,
	canonicalReadlistPageRedirect,
} from "./readlist.url";
import {
	type ReadlistContext,
	initResolveReadlistContext,
	mainlineReadlistContext,
	readerReadlists,
} from "./readlist-context";
import { readlistScopedStore } from "./readlist-scoped-store";
import { MARK_STATUS_ACK_NEVER } from "./mark-status-confirm.component";
import { DELETE_ACK_NEVER } from "./readlist-card/delete-confirm.component";
import {
	DEFAULT_READLIST_SLUG,
	ReadlistLimitReachedError,
	ReadlistSlugSchema,
	type ReadlistRenameRejection,
	type ReadlistSlug,
	decideReadlistCreate,
	decideReadlistDelete,
	decideReadlistMigration,
	decideReadlistRename,
	defaultReadlistLabel,
	generateReadlistSlug,
	readlistAfterDelete,
} from "@packages/domain/readlist";
import {
	type ReaderReadlistFiling,
	buildReaderReadlistFiling,
} from "./reader-readlist-filing";
import type { ReadlistRailViewModel } from "./readlist.component";
import { readlistReturnQuery } from "./readlist.url";
import { collectUtmParams } from "../../shared/utm";
import { deriveKnownUnreadCount } from "./known-unread-count";
import { READLIST_TAB_STATUSES, tabQuery } from "./readlist.tabs";
import { READLIST_PAGE_SIZE, readlistPageSizeForClient } from "./readlist-page-size";
import { resolveSaveProvenance } from "../../shared/save-provenance";
import type { HttpErrorMessageMapping, StatusFlash } from "./readlist.error";
import { READLIST_ERROR_LIMIT, READLIST_ERROR_UNKNOWN_READLIST, READLIST_RENAME_REJECTIONS, collectStatusFlashParams, importFlashMapping, readlistErrorFlashMapping, saveableUrlErrorCodeMapping, statusFlashMapping, statusFlashFor } from "./readlist.error";
import { renderReadlistMutationFragment } from "./readlist-mutation-fragments";
import { HtmlPage } from "@packages/web-shell";
import { MAX_POLLS } from "@packages/web-shell";
import { parsePollParam } from "@packages/web-shell";
import { toReadlistArticleViewModel, toReadlistViewModel } from "./readlist.viewmodel";
import { ReadlistPage } from "./readlist.component";
import {
	UNREAD_BADGE_COUNT_LIMIT,
	renderReadlistCounts,
	toReadlistCountsDisplayModel,
} from "./readlist-counts.component";
import {
	renderReadlistCard,
	toReadlistCardDisplayModel,
} from "./readlist-card/readlist-card.component";
import { computeReadlistCardEtag } from "./readlist-card/readlist-card.etag";
import { computeArticleContentVersion } from "../../shared/article-content-version";
import { readerCachePolicy } from "./reader-cache-policy";
import { VIEW_BACK_LINK } from "./reader-skeleton/reader-skeleton.component";
import { etagMatches } from "@packages/web-shell";
import { ReaderPage, formatReaderDocumentTitle } from "../reader/reader.component";
import { renderNextRead } from "../../shared/next-read/next-read.component";
import { safeReturnPath } from "../../shared/safe-return-path";
import { NO_CLIENT_ONBOARDING_VERSION, ONBOARDING_VERSION, hasOutstandingStep } from "../../onboarding/onboarding.steps";
import {
	extensionInstallUrlIfMissing,
	canOfferExtensionInstall,
	hasInstallableClient,
	isExtensionInstalled,
	isExtensionSavedArticle,
	advertisedPlatformOf,
	type PitchablePlatform,
} from "../../onboarding/extension-install";
import {
	APP_SHELL_QUERY,
	APP_SHELL_VALUE,
	PLATFORM_QUERY,
	hasBackgroundSaveContinuity,
	isAppShell,
	isNativeClient,
	isNativeSurface,
	nativeClientOf,
	nativeSurfaceOf,
} from "../../onboarding/native-client";
import { setSirenCollectionCaching } from "../../siren-discovery-cache";
import { APP_BACK_LINK } from "../../shared/native-app-links";
import type {
	GetOnboardingSignals,
	NativeAppPlatform,
	RecordDeleteArticleAcknowledged,
	RecordEmailStepMarkedDone,
	RecordNativeAppAnyActivity,
	RecordNativeAppSavedArticle,
	RecordNextReadMinimumReached,
	RecordMarkReadAcrossQueuesAcknowledged,
	RecordOnboardingOutstandingVersion,
} from "@packages/provider-contracts/onboarding-signals";
import type { InstallableClientOnboarding, OnboardingContext, Platform } from "../../onboarding/onboarding.types";
import type { GetEffectiveAccess } from "@packages/subscription-access";

/** The dismiss-cookie value a device of this class writes on dismissal and the
 * GET read expects back: the step-hash {@link ONBOARDING_VERSION} when the device
 * has an installable client (so shipping a new onboarding step re-onboards it),
 * the stable {@link NO_CLIENT_ONBOARDING_VERSION} otherwise (so the no-client
 * escape card — which such users can never complete away — stays dismissed no
 * matter how the steps change). The dismiss POST and the GET read derive it from
 * the same predicate here, so they can't drift; the one runtime coupling left is
 * that both requests report the same device class, which a same-browser HTML form
 * submit guarantees by carrying the GET's User-Agent. Preserve that parity if
 * dismissal ever becomes a background request that could drop or alter the UA. */
function dismissTokenFor(hasClient: boolean): string {
	return hasClient ? ONBOARDING_VERSION : NO_CLIENT_ONBOARDING_VERSION;
}

function readImportSkippedFlash(
	req: Request,
	res: Response,
): ImportSkippedViewModel | undefined {
	const raw = req.cookies?.[IMPORT_SKIPPED_COOKIE_NAME];
	const decoded = decodeImportSkippedCookie(raw);
	if (!decoded || decoded.entries.length === 0) return undefined;
	/** Cookie is read-once: clear it so a refresh of /queue doesn't keep
	 * surfacing the "couldn't import" banner. */
	res.clearCookie(IMPORT_SKIPPED_COOKIE_NAME, { path: READLIST_PATH });
	return {
		entries: decoded.entries.map((e) => ({
			url: e.url,
			reasonLabel: saveableUrlErrorMessage(e.code),
		})),
		andMore: decoded.andMore,
	};
}

function markExtensionSavedArticle(res: Response): void {
	res.cookie(SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE, {
		path: "/",
		maxAge: EXTENSION_LIVENESS_TTL_MS,
		sameSite: "lax",
		httpOnly: true,
	});
}

type SaveContentResult =
	| { ok: true }
	| { ok: false; code: string; message: string };

type SaveContentMedia = {
	uploadCeilingBytes: number;
	stageInlineBytes: (input: {
		url: string;
		bytes: Buffer;
		title?: string;
		userId: UserId;
	}) => Promise<SaveContentResult>;
	admitUploadedBytes: (input: {
		url: SaveableUrl;
		mediaType: string;
		title?: string;
		userId: UserId;
	}) => Promise<SaveContentResult>;
};

const NOT_A_PDF: SaveContentResult = {
	ok: false,
	code: "not-a-pdf",
	message: "Uploaded bytes do not look like a PDF (missing %PDF- magic header)",
};

function normalizeMediaType(mediaType: string): string {
	const base = mediaType.split(";")[0].trim().toLowerCase();
	if (isPDF({ contentType: base })) return "application/pdf";
	return base;
}

function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function bytesToMb(bytes: number): number {
	return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

/** Minute-precision UTC id as recorded in the crawl-version log, e.g.
 * "2026-07-10T09:41Z" — the value the reader's remove-version form submits. */
const CrawlVersionMinuteIdSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);

interface ReadlistDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	findArticleUrlById: FindArticleUrlById;
	saveArticle: SaveArticle;
	saveArticleKeepingPosition: SaveArticle;
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
	moveReadlistArticles: MoveReadlistArticles;
	listReadlistDefinitions: ListReadlistDefinitions;
	createReadlistDefinition: CreateReadlistDefinition;
	renameReadlistDefinition: RenameReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	markSummaryToggled: MarkSummaryToggled;
	markRelatedDismissed: MarkRelatedDismissed;
	publishLinkSaved: PublishLinkSaved;
	publishLinkQueued: PublishLinkQueued;
	publishLinkDequeued: PublishLinkDequeued;
	publishQueueEntryCreated: PublishQueueEntryCreated;
	findRelatedArticles: FindRelatedArticles;
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
	refreshArticleIfStale: RefreshArticleIfStale;
	allocateSavedAt: AllocateSavedAt;
	allocateSavedAtSequence: AllocateSavedAtSequence;
	findSavedUrls: FindSavedUrls;
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	readArticleContent: ReadArticleContent;
	/** The reader's Back + Mark-as-read action bar, injected per variant: the sticky
	 * toolbar for the web reader, the chromeless sticky variant for the iOS app. Both
	 * pin the toolbar and drop the bottom bar; they differ only in where it pins. */
	stickyReader: RenderReaderActions;
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
	secureCookies: boolean;
	getEffectiveAccess: GetEffectiveAccess;
	findUserById: FindUserById;
	buildBannerState: BuildBannerState;
	/** The site-wide announcement, for the chromeless reader only. The full shell
	 * reaches it through `buildBannerState`; the chromeless branch takes it directly
	 * so an in-app article open doesn't pay for the trial/access lookup that
	 * `buildBannerState` also performs and this shell has nowhere to render. */
	getChangelogBanner: GetChangelogBanner;
	logError: (message: string, error?: Error) => void;
	recordAnalyticsEvent: RecordAudienceEvent<AnalyticsEvent>;
	recordUngatedAnalyticsEvent: RecordUngatedEvent<AnalyticsEvent>;
	salt: string;
	now: () => Date;
}

import type { SavedArticle } from "@packages/domain/article";

async function loadSummaries(
	findGeneratedSummaries: FindGeneratedSummaries,
	articles: readonly SavedArticle[],
	logError: (message: string, error?: Error) => void,
): Promise<Map<string, GeneratedSummary | undefined>> {
	const urls = articles.map((a) => a.url);
	try {
		const byUrl = await findGeneratedSummaries(urls);
		return new Map(urls.map((url) => [url, byUrl.get(url)] as const));
	} catch (error) {
		// A whole-batch transport failure degrades every card to "no summary chip"
		// (the same visible outcome the old per-item allSettled produced), but log
		// it — the previous silent swallow made this class of failure invisible.
		logError("Failed to batch-load article summaries", error instanceof Error ? error : undefined);
		return new Map(urls.map((url) => [url, undefined] as const));
	}
}

async function loadCrawls(
	findArticleCrawlStatuses: FindArticleCrawlStatuses,
	articles: readonly SavedArticle[],
	logError: (message: string, error?: Error) => void,
): Promise<Map<string, ArticleCrawl | undefined>> {
	const urls = articles.map((a) => a.url);
	try {
		const byUrl = await findArticleCrawlStatuses(urls);
		return new Map(urls.map((url) => [url, byUrl.get(url)] as const));
	} catch (error) {
		logError("Failed to batch-load article crawl statuses", error instanceof Error ? error : undefined);
		return new Map(urls.map((url) => [url, undefined] as const));
	}
}

const relatedPollUrlFor = (articleId: string, pollCount: number): string =>
	`${READLIST_PATH}/${articleId}/related?poll=${pollCount}`;

async function loadRelatedArticles(
	findRelatedArticles: FindRelatedArticles,
	article: SavedArticle,
	logError: (message: string, error?: Error) => void,
): Promise<RelatedArticles> {
	try {
		return await findRelatedArticles({
			userId: article.userId,
			url: article.url,
		});
	} catch (error) {
		logError(
			"Failed to load related articles",
			error instanceof Error ? error : undefined,
		);
		return { status: "pending" };
	}
}

const READLIST_PURGE_PAGE_SIZE = 25;

const SAVE_ROUTE = {
	saveArticle: "/",
	saveArticles: "/save-articles",
	save: "/save",
	saveContent: "/save-content",
} as const;

/** Root ("/") maps to READLIST_PATH alone; appending it would record a spurious "/queue/" trailing slash. */
const saveIntentPath = (route: string): string =>
	route === "/" ? READLIST_PATH : `${READLIST_PATH}${route}`;

const SAVE_INTENT_PATH = {
	saveArticle: saveIntentPath(SAVE_ROUTE.saveArticle),
	saveArticles: saveIntentPath(SAVE_ROUTE.saveArticles),
	save: saveIntentPath(SAVE_ROUTE.save),
	saveContent: saveIntentPath(SAVE_ROUTE.saveContent),
} as const;

/** Resolves the one way this page can reach whichever native web view is hosting
 * it, or null in an ordinary browser. Each platform's bridge is shaped by its own
 * SDK and cannot be normalised away: WKWebView takes a structured object, while an
 * Android `addJavascriptInterface` method takes a string. The iOS arm is checked
 * first and left byte-identical, so builds already on phones keep the exact call
 * they shipped against. */
const readerBridgePostFn = `
	var post = (function () {
		var handlers = window.webkit && window.webkit.messageHandlers;
		if (handlers && handlers.readplaceReader) {
			return function (message) { handlers.readplaceReader.postMessage(message); };
		}
		var androidBridge = window.ReadplaceReader;
		if (androidBridge && typeof androidBridge.postMessage === "function") {
			return function (message) { androidBridge.postMessage(JSON.stringify(message)); };
		}
		return null;
	})();
	if (!post) { return; }`;

/** Server-authored bridge for an app's in-app reader: when the reader's mark-read
 * htmx request completes, tell the host web view so the native app closes the sheet
 * and reconciles its list. Guarded on the bridge being present, so it is inert
 * in a normal browser that renders this same reader. Keeping the htmx detail here —
 * rather than injected by the app — keeps the htmx coupling on the server that owns
 * htmx; the app only registers the `readplaceReader` bridge and reacts to the
 * `markedRead` message, with no knowledge of the front-end's event shape. */
const readerMarkReadBridgeScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {${readerBridgePostFn}
	function hasStatusField(params) {
		if (!params) { return false; }
		if (typeof params.has === "function") { return params.has("status"); }
		if (typeof params.get === "function") { return params.get("status") != null; }
		return Object.prototype.hasOwnProperty.call(params, "status");
	}
	function isStatusChange(detail) {
		var cfg = (detail && detail.requestConfig) || {};
		var verb = (cfg.verb || "").toString().toUpperCase();
		var xhr = (detail && detail.xhr) || {};
		return verb === "POST" && hasStatusField(cfg.parameters) && xhr.status >= 200 && xhr.status < 400;
	}
	document.body.addEventListener("htmx:beforeSwap", function (event) {
		if (!isStatusChange(event.detail)) { return; }
		event.detail.shouldSwap = false;
		post({ type: "markedRead" });
	});
})();
</script>`;

const readerCaptureBridgeScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {${readerBridgePostFn}
	document.documentElement.setAttribute("data-reader-capture-host", "");
	document.body.addEventListener("click", function (event) {
		var target = event.target;
		var button = target && target.closest ? target.closest("[data-reader-capture]") : null;
		if (!button) { return; }
		button.disabled = true;
		post({ type: "captureBlocked" });
		var pollUrl = button.getAttribute("data-reader-capture-poll");
		if (!pollUrl) { return; }
		function poll() {
			window.htmx.ajax("GET", pollUrl, { target: "#article-body-reader-slot", swap: "outerHTML" });
		}
		if (window.htmx) { poll(); return; }
		document.body.addEventListener("htmx:load", poll, { once: true });
	});
})();
</script>`;

/** True when the client wants an app's chromeless reader rather than the full web
 * shell — chosen by an explicit client signal, never a user-agent sniff. The app
 * appends `?platform=` to the `read` link it loads in its web view; the
 * `x-readplace-client` header is honoured alongside it so a store-reviewed build
 * predating the query param — which cannot deploy in lockstep with the server —
 * still resolves to its chromeless reader. */
const isAppPlatform = (req: Request): boolean => isNativeSurface(req);

/** Whose install/save signals a device's platform reads: a native app's own
 * server-side pair, or `undefined` for the extension's same-browser cookies.
 * Every platform is answered explicitly, so a new content-capture client is a
 * compile error here until it is told which signals it ticks — a phone app
 * silently reading another phone's pair would tick a step on a device the user
 * does not have. */
const NATIVE_APP_SIGNAL_PLATFORM = {
	iphone: "ios",
	android: "android",
	firefox: undefined,
	chrome: undefined,
	other: undefined,
} as const satisfies Record<Platform, NativeAppPlatform | undefined>;

export function initReadlistRoutes(deps: ReadlistDependencies): Router {
	const router = express.Router();
	const saveArticleFromUrl = initSaveArticleFromUrl(deps);
	const saveArticleAtReadlistTop = initSaveArticleAtReadlistTop({
		allocateSavedAt: deps.allocateSavedAt,
		saveArticleFromUrl,
	});
	const attachArticleContent = initSaveArticleFromUrl({
		...deps,
		saveArticle: deps.saveArticleKeepingPosition,
	});

	const resolveReadlistContext = initResolveReadlistContext({
		listReadlistDefinitions: deps.listReadlistDefinitions,
	});

	/** Mutation and redirect handlers read the addressed readlist from the URL alone.
	 * A shape-valid readlist the reader does not own binds to a partition holding no
	 * rows, so the write no-ops on its `attribute_exists` condition and the reader
	 * lands back on a listing the next GET resolves for real. */
	const requestReadlistContext = (req: Request): ReadlistContext => ({
		...mainlineReadlistContext(req.query),
		state: parseReadlistUrl(req.query),
	});

	const publishLinkDequeuedUnlessSavedElsewhere = initPublishLinkDequeuedUnlessSavedElsewhere({
		listUserSavesForUrl: deps.listUserSavesForUrl,
		publishLinkDequeued: deps.publishLinkDequeued,
	});

	/** The one place a request's readlist decides which rows it reads and writes.
	 * The default readlist answers with the untouched mainline dependencies, so every
	 * handler below runs today's code path byte for byte unless a reader addressed
	 * one of their own readlists. */
	const storeFor = (readlist: ReadlistSlug) => readlistScopedStore(deps, readlist);

	const purgeReadlistArticles = async (params: {
		userId: UserId;
		readlist: ReadlistSlug;
	}): Promise<void> => {
		const deleteOne = deleteArticleFromReadlistFor(params.readlist);
		for (;;) {
			const { articles } = await deps.findReadlistArticles({
				userId: params.userId,
				readlist: params.readlist,
				pageSize: READLIST_PURGE_PAGE_SIZE,
				excludeContent: true,
			});
			if (articles.length === 0) return;
			for (const article of articles) {
				await deleteOne({ articleId: article.id, userId: params.userId });
			}
		}
	};

	const deleteArticleFromReadlistFor = (readlist: ReadlistSlug) =>
		initDeleteArticleFromReadlist({
			...deps,
			deleteArticle: storeFor(readlist).deleteArticle,
			publishLinkDequeued: publishLinkDequeuedUnlessSavedElsewhere,
		});

	/** An onboarding signal is non-essential bookkeeping that sits on the critical
	 * path of the app's readlist load and every save. Unlike the extension's
	 * equivalent — a Set-Cookie header that cannot fail — these writes hit DynamoDB
	 * and can throw (a transient error, or `assert(row)` firing for a token that
	 * outlived a deleted account). Swallow and log so the bookkeeping can never
	 * turn a successful save into a 500 or break the iPhone app's readlist load; the
	 * signal is allowed to lag a render and catch up on the next request. */
	const recordOnboardingSignalBestEffort = async (record: () => Promise<void>): Promise<void> => {
		try {
			await record();
		} catch (error) {
			deps.logError(
				"Failed to record onboarding signal",
				error instanceof Error ? error : undefined,
			);
		}
	};

	/** Records that the user saved their first article. From a native app (client
	 * header present) this is a per-user server-side write so the phone browser's
	 * `/queue` can read it; from the extension it is the same-browser-jar liveness
	 * cookie. */
	const recordSaveSignal = async (req: Request, res: Response, userId: UserId): Promise<void> => {
		const platform = nativeClientOf(req);
		if (platform) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordNativeAppSavedArticle({ userId, platform }),
			);
			return;
		}
		markExtensionSavedArticle(res);
	};

	/** Records a save-intent for an authenticated save surface. The save has
	 * already happened (or failed) by the time this is called, so `outcome` is
	 * `saved` or `error` — never `prompted_to_sign_up`, which is anonymous-only. */
	const emitSaveIntent = (params: {
		req: Request;
		url: string;
		path: string;
		surface: SaveSurface;
		outcome: SaveOutcome;
	}): void => {
		deps.recordAnalyticsEvent(
			params.req,
			buildSaveIntentEvent({ now: deps.now, salt: deps.salt }, { ...params, client: saveClientOf(params.req) }),
		);
	};

	const saveContentMedia: Record<string, SaveContentMedia> = {
		"application/pdf": {
			uploadCeilingBytes: MAX_PDF_BYTES.bytes,
			stageInlineBytes: async ({ url, bytes, title, userId }) => {
				if (!isPDF({ bodyBytes: bytes })) return NOT_A_PDF;
				await deps.putPendingPdf({ url, bytes });
				await deps.publishSaveLinkRawPdfCommand({ url, userId, title });
				return { ok: true };
			},
			admitUploadedBytes: async ({ url, mediaType, title, userId }) => {
				const prefix = await deps.readPendingUploadPrefix({ url, mediaType, bytes: 8 });
				if (!isPDF({ bodyBytes: prefix })) return NOT_A_PDF;
				await deps.publishSaveLinkRawPdfCommand({ url, userId, title });
				return { ok: true };
			},
		},
		"text/html": {
			uploadCeilingBytes: MAX_HTML_BYTES.bytes,
			stageInlineBytes: async ({ url, bytes, title, userId }) => {
				await deps.putPendingHtml({ url, html: bytes.toString("utf8") });
				await deps.publishSaveLinkRawHtmlCommand({ url, userId, title });
				return { ok: true };
			},
			admitUploadedBytes: async ({ url, title, userId }) => {
				await deps.publishSaveLinkRawHtmlCommand({ url, userId, title });
				return { ok: true };
			},
		},
	};

	const mediaFor = (params: { mediaType: string; url: string }): SaveContentMedia | undefined =>
		isNonArticleHost(params.url)
			? undefined
			: saveContentMedia[normalizeMediaType(params.mediaType)];

	const reader = initArticleReader({
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		appOrigin: deps.appOrigin,
		formatDocumentTitle: formatReaderDocumentTitle,
		summaryOpen: false,
		now: deps.now,
	});
	const resolveReaderPermalinkIn = (readlist: ReadlistSlug) =>
		initReaderPermalink({
			findArticleById: storeFor(readlist).findArticleById,
			findArticleUrlById: deps.findArticleUrlById,
			findArticleByUrl: deps.findArticleByUrl,
		});

	function pollUrlBuilderFor(req: Request, articleId: string): PollUrlBuilder {
		const surface = nativeSurfaceOf(req);
		const platform = surface ? `&${PLATFORM_QUERY}=${surface}` : "";
		const shell = isAppShell(req) ? `&${APP_SHELL_QUERY}=${APP_SHELL_VALUE}` : "";
		return {
			summary: (n) => `${READLIST_PATH}/${articleId}/summary?poll=${n}${platform}${shell}`,
			reader: (n, capturing) =>
				`${READLIST_PATH}/${articleId}/reader?poll=${n}${capturing ? "&capturing=1" : ""}${platform}${shell}`,
		};
	}

	const ownerReaderViewFailedOob = (req: Request): ReaderViewFailedOob =>
		isAppPlatform(req)
			? NO_READER_VIEW_FAILED_OOB
			: extensionSuggestionBannerOob(req);

	const readerReturnPath = (req: Request, articleId: string): string => {
		const surface = nativeSurfaceOf(req);
		return surface
			? `${READLIST_PATH}/${articleId}/view?${PLATFORM_QUERY}=${surface}`
			: `${READLIST_PATH}/${articleId}/view`;
	};

	const parseCapturingFlag = (raw: unknown): boolean =>
		z.literal("1").safeParse(raw).success;

	/** Public share-able permalink. Users copy this URL from the browser
	 * address bar to share an article, so any visitor — owner, different
	 * logged-in user, or anonymous — must land somewhere useful. Owners get
	 * their personalised reader (mark-as-read button, progress). Everyone
	 * else is redirected to `/view/<original-url>`, the public route that
	 * already has full OG/Twitter/Schema.org metadata so social-media
	 * previews unfurl correctly. Declared BEFORE `router.use(deps.dualAuth)`
	 * so the auth middleware doesn't pre-empt anonymous traffic with a
	 * /login redirect.
	 *
	 * The `/queue/:id/read` URL 301-redirects to `/queue/:id/view` so
	 * existing bookmarks, share links, search-engine indexes and Siren
	 * `rel="read"` hrefs keep resolving. */
	router.get("/:id/read", noindexMiddleware, (req: Request, res: Response) => {
		const queryIndex = req.originalUrl.indexOf("?");
		const queryString = queryIndex !== -1 ? req.originalUrl.slice(queryIndex) : "";
		res.redirect(301, `${READLIST_PATH}/${req.params.id}/view${queryString}`);
	});

	const readerReadlistFilingFor = async (params: {
		userId: UserId;
		article: SavedArticle;
		returnTo: string;
	}): Promise<ReaderReadlistFiling> => {
		const [definitions, saves, signals] = await Promise.all([
			deps.listReadlistDefinitions(params.userId),
			deps.listUserSavesForUrl({ userId: params.userId, url: params.article.url }),
			deps.getOnboardingSignals({ userId: params.userId }),
		]);
		return buildReaderReadlistFiling({
			articleId: params.article.id.value,
			definitions,
			saves,
			returnTo: params.returnTo,
			markStatusConfirmGated:
				readerReadlists(definitions).length > 1 &&
				signals.markReadAcrossQueuesAckedAt === undefined,
		});
	};

	type ResolvedReaderState = Awaited<ReturnType<typeof reader.resolveReaderState>>;
	type OwnerReaderResolution =
		| { kind: "redirect"; redirect: Redirect }
		| { kind: "not-found" }
		| {
				kind: "ready";
				article: SavedArticle;
				state: ResolvedReaderState;
				related: RelatedArticles;
				relatedPollUrl: string | undefined;
				readlistFiling: ReaderReadlistFiling;
				contentVersion: string;
			};

	/** Ownership/access (owner → reader; non-owner or anonymous → permalink
	 * redirect) comes entirely from resolveReaderPermalink, so both the full-shell
	 * and the `?platform=ios` chromeless renders of `/view` inherit it identically.
	 * Stamps reader-view presence on the owner open — the only server-side signal
	 * that the reader was opened. */
	const resolveOwnerReader = async (
		req: Request<{ id: string }>,
	): Promise<OwnerReaderResolution> => {
		const readerReadlist = requestReadlistContext(req).state.readlist;
		const result = await resolveReaderPermalinkIn(readerReadlist)({
			rawId: req.params.id,
			requesterId: req.userId,
			query: req.query,
		});

		if (result.kind === "redirect") {
			return { kind: "redirect", redirect: result.redirect };
		}

		if (result.kind === "not-found") {
			return { kind: "not-found" };
		}

		const ownedArticle = result.article;

		await storeFor(readerReadlist).markArticleViewed({
			userId: ownedArticle.userId,
			url: ownedArticle.url,
			at: deps.now(),
		});

		const [related, state, readlistFiling] = await Promise.all([
			loadRelatedArticles(deps.findRelatedArticles, ownedArticle, deps.logError),
			reader.resolveReaderState({
				article: {
					url: ownedArticle.url,
					metadata: ownedArticle.metadata,
					estimatedReadTime: ownedArticle.estimatedReadTime,
				},
				pollUrlBuilder: pollUrlBuilderFor(req, ownedArticle.id.value),
				capturing: false,
			}),
			readerReadlistFilingFor({
				userId: ownedArticle.userId,
				article: ownedArticle,
				returnTo: readerReturnPath(req, ownedArticle.id.value),
			}),
		]);
		const relatedPollUrl =
			ownedArticle.relatedDismissedAt === undefined
				? relatedPollUrlFor(ownedArticle.id.value, 1)
				: undefined;
		const contentVersion = computeArticleContentVersion({
			article: ownedArticle,
			crawl: state.crawl,
			summary: state.summary,
		});

		if (state.notice !== undefined) {
			const hostname = new URL(ownedArticle.url).hostname;
			return {
				kind: "ready",
				article: {
					...ownedArticle,
					content: undefined,
					metadata: { title: hostname, siteName: hostname, excerpt: "", wordCount: 0 },
					estimatedReadTime: calculateReadTime(0),
				},
				state,
				related: { status: "skipped" },
				relatedPollUrl: undefined,
				readlistFiling,
				contentVersion,
			};
		}

		return {
			kind: "ready",
			article: ownedArticle,
			state,
			related,
			relatedPollUrl,
			readlistFiling,
			contentVersion,
		};
	};

	router.get("/:id/view", noindexMiddleware, async (req: Request<{ id: string }>, res: Response) => {
		const resolved = await resolveOwnerReader(req);
		if (resolved.kind === "redirect") {
			sendComponent(req, res, RedirectComponent(resolved.redirect));
			return;
		}

		if (resolved.kind === "not-found") {
			sendComponent(req, res, Base(NotFoundPage(), await deps.buildBannerState(req)));
			return;
		}

		const { article: ownedArticle, state, related, relatedPollUrl, readlistFiling, contentVersion } =
			resolved;

		const cspNonce = requireCspNonce(req);
		const readerSettled =
			state.readerPollUrl === undefined &&
			state.summaryPollUrl === undefined &&
			related.status !== "pending";
		const readerCacheControl = readerCachePolicy({
			requestedVersion: req.query.v,
			currentVersion: contentVersion,
			settled: readerSettled,
		});
		res.vary("Cookie");

		if (isAppPlatform(req)) {
			const appearance = (await deps.findUserById(ownedArticle.userId))?.appearance ?? "system";
			const readerBody = ReaderPage({ ...ownedArticle, content: state.content }, {
				appOrigin: deps.appOrigin,
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				capturePollUrl: state.capturePollUrl,
				progress: state.progress,
				related,
				relatedPollUrl,
				currentPath: req.originalUrl,
				now: deps.now(),
				extensionInstallUrl: undefined,
				backLink: APP_BACK_LINK,
				renderActions: deps.chromelessReader,
				readlistFiling,
				markStatusConfirmReadlistLabels: readlistFiling.markStatusConfirmReadlistLabels,
				readerNotice: state.notice,
			});
			assert(readerBody.scripts, "the reader page always sets its scripts");
			sendComponent(
				req, res,
				FreshForComponent(
					ChromelessPage(
						{
							...readerBody,
							scripts:
								readerBody.scripts +
								readerMarkReadBridgeScript(cspNonce) +
								(state.notice === undefined ? readerCaptureBridgeScript(cspNonce) : ""),
						},
						{
							changelogBanner: selectChangelogBanner(
								await deps.getChangelogBanner(),
								req.dismissedChangelogVersion,
							),
							// The dismiss form posts this back so the 303 lands on the same
							// article, still carrying `platform=ios` — so the reader returns to
							// the chromeless shell rather than the full web one.
							currentPath: req.originalUrl,
							cspNonce,
							appearance,
						},
					),
					{ ifNoneMatch: req.get("If-None-Match"), cspNonce, cacheControl: readerCacheControl },
				),
			);
			return;
		}

		const showExtensionSuggestionBanner =
			state.readerViewFailed && canOfferExtensionInstall(req);

		// Owner-only removal controls: which snapshots this owner authored, so the
		// bookmark can offer to delete their versions. Only the full-shell owner
		// reader below gets it — never the public /view or the iOS chromeless
		// branch above.
		const authoredVersions =
			state.notice === undefined ? await deps.findArticleCrawlVersions(ownedArticle.url) : [];
		const authoredMinuteIds = authoredVersions
			.filter((version) => version.authorUserId === ownedArticle.userId)
			.map((version) => version.crawledAtMinute);
		const crawlBookmarkRemoval = {
			authoredMinuteIds,
			removeVersionUrl: withInternalTracking(
				`${READLIST_PATH}/${ownedArticle.id.value}/remove-my-version`,
				{ source: "reader-crawl-bookmark", content: "remove-my-version" },
			),
		};

		sendComponent(
			req, res,
			FreshForComponent(
				Base(ReaderPage({ ...ownedArticle, content: state.content }, {
					appOrigin: deps.appOrigin,
					summary: state.summary,
					summaryPollUrl: state.summaryPollUrl,
					crawl: state.crawl,
					readerPollUrl: state.readerPollUrl,
					capturePollUrl: state.capturePollUrl,
					progress: state.progress,
					related,
					relatedPollUrl,
					currentPath: req.originalUrl,
					now: deps.now(),
					extensionInstallUrl: extensionInstallUrlIfMissing(req),
					backLink: VIEW_BACK_LINK,
					renderActions: deps.stickyReader,
					readlistFiling,
					markStatusConfirmReadlistLabels: readlistFiling.markStatusConfirmReadlistLabels,
					crawlVersions: state.crawlVersions,
					crawlBookmarkRemoval,
					exitMarkReadConfirm: true,
					readerNotice: state.notice,
					epubDownloadHref:
						state.content === undefined || !revealsEpubDownload(req.query.feature)
							? undefined
							: buildEpubDownloadHref({ articleUrl: ownedArticle.url, utmSource: "reader" }),
				}), {
					...(await deps.buildBannerState(req)),
					showExtensionSuggestionBanner,
					extensionInstalled: isExtensionInstalled(req),
				}),
				{ ifNoneMatch: req.get("If-None-Match"), cspNonce, cacheControl: readerCacheControl },
			),
		);
	});

	router.post(
		SAVE_ROUTE.saveArticles,
		initObserveSaveRefusal({
			recordUngatedAnalyticsEvent: deps.recordUngatedAnalyticsEvent,
			now: deps.now,
			salt: deps.salt,
			path: SAVE_INTENT_PATH.saveArticles,
		}),
	);

	router.use(deps.dualAuth);
	router.use(deps.resolveVerificationStatus);

	/** Resolves how far the account is toward the Next Read minimum, capped at it.
	 * Once the milestone is stamped the answer is the cap and no count is issued,
	 * which is both what makes the step sticky against later deletions and what
	 * keeps a bounded COUNT query off the steady-state `/queue` render. Stamping
	 * here memoises an observation the same request already made — the account
	 * really does hold that many saves — rather than mutating anything the user
	 * can see, which is why it is allowed on a GET. */
	const resolveSavedCount = async (
		userId: UserId,
		nextReadMinimumReachedAt: Date | undefined,
	): Promise<number> => {
		if (nextReadMinimumReachedAt) {
			return NEXT_READ_MINIMUM_SAVES;
		}
		const savedCount = await deps.countArticlesByUser({
			userId,
			countLimit: NEXT_READ_MINIMUM_SAVES,
		});
		if (hasEnoughSavesForNextRead(savedCount)) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordNextReadMinimumReached({ userId }),
			);
		}
		return savedCount;
	};

	/** Resolves the onboarding-checklist signals for an authenticated `/queue`
	 * HTML render. Shared by the top-of-page GET and the save-bar 422 error
	 * re-render so both surface the same card for the device — resolving it in one
	 * place is what stops the 422 path from defaulting `hasInstallableClient` to
	 * false and rendering the no-client card to devices that do have a client.
	 *
	 * Completion source is resolved by platform: iPhone reads the per-user
	 * server-side iOS signal (Safari can't see the app's cookies); every other
	 * platform reads the same-browser extension liveness/save cookies.
	 *
	 * Dismissal compares the cookie against {@link dismissTokenFor} for the device
	 * class. Client devices additionally require the install step complete in *this*
	 * context: the dismiss button only appears once every step is done, so a dismiss
	 * without `installed` means a different context (a different browser, or a phone
	 * whose app isn't signed in) — re-show so the user can finish here. When a client
	 * later ships for a currently-clientless device, hasClient flips true and the read
	 * falls through to this `installed && …` arm, where the no-client token no longer
	 * matches and the new client isn't installed, so onboarding re-appears. */
	const resolveOnboardingSignals = async (req: Request, userId: UserId) => {
		const advertisedPlatform = advertisedPlatformOf(req);
		const platform: PitchablePlatform = advertisedPlatform ?? "other";
		const hasClient = advertisedPlatform !== undefined;
		const dismissCookie = req.cookies?.[DISMISS_COOKIE_NAME];
		const dismissTokenMatches = dismissCookie === dismissTokenFor(hasClient);
		const onboardingCompletedBefore =
			dismissCookie !== undefined && dismissCookie !== NO_CLIENT_ONBOARDING_VERSION;
		const signals = await deps.getOnboardingSignals({ userId });
		const markReadAcrossQueuesAckedAt = signals.markReadAcrossQueuesAckedAt;
		const deleteArticleAckedAt = signals.deleteArticleAckedAt;
		if (!hasClient) {
			const noClientContext: OnboardingContext = { hasInstallableClient: false };
			return {
				markReadAcrossQueuesAckedAt,
				deleteArticleAckedAt,
				onboarding: {
					context: noClientContext,
					dismissed: dismissTokenMatches,
					completedBefore: onboardingCompletedBefore,
					completionUnearned: false,
				},
			};
		}
		const nativeAppPlatform = NATIVE_APP_SIGNAL_PLATFORM[platform];
		const { installed, savedArticle } = nativeAppPlatform
			? signals.nativeApp[nativeAppPlatform]
			: { installed: isExtensionInstalled(req), savedArticle: isExtensionSavedArticle(req) };
		const savedCount = await resolveSavedCount(userId, signals.nextReadMinimumReachedAt);
		const context: InstallableClientOnboarding = {
			hasInstallableClient: true,
			platform,
			installed,
			savedArticle,
			savedCount,
			inboxArticleQueued: signals.firstInboxArticleQueuedAt !== undefined,
			emailStepMarkedDone: signals.emailStepMarkedDoneAt !== undefined,
		};
		const seenUnderThisVersion = signals.onboardingOutstandingVersion === ONBOARDING_VERSION;
		if (!seenUnderThisVersion && hasOutstandingStep(context)) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordOnboardingOutstandingVersion({ userId, version: ONBOARDING_VERSION }),
			);
		}
		return {
			markReadAcrossQueuesAckedAt,
			deleteArticleAckedAt,
			onboarding: {
				context,
				dismissed: installed && dismissTokenMatches,
				completedBefore: onboardingCompletedBefore,
				completionUnearned: !seenUnderThisVersion,
			},
		};
	};

	const markStatusConfirmLabelsFor = async (params: {
		userId: UserId;
		context: ReadlistContext;
		urls: readonly string[];
		acknowledgedAt: Date | undefined;
	}): Promise<ReadonlyMap<string, readonly string[]> | undefined> => {
		if (params.context.readlists.length <= 1) return undefined;
		if (params.acknowledgedAt !== undefined) return undefined;
		const savesByUrl = await deps.listUserSavesForUrls({
			userId: params.userId,
			urls: params.urls,
		});
		return new Map(
			params.urls.map((url) => {
				const memberSlugs = new Set(
					(savesByUrl.get(url) ?? []).map((save) => save.readlist ?? DEFAULT_READLIST_SLUG),
				);
				return [
					url,
					params.context.readlists
						.filter((readlist) => memberSlugs.has(readlist.slug))
						.map((readlist) => readlist.label),
				];
			}),
		);
	};

	const buildReadlistRail = (
		req: Request,
		context: ReadlistContext,
		accessIsReadOnly: boolean,
	): ReadlistRailViewModel => {
		const canCreate = !accessIsReadOnly;
		return {
			readlists: context.readlists,
			activeReadlist: context.activeReadlist,
			newReadlistAction: `${READLIST_CREATE_PATH}${readlistReturnQuery(context.state)}`,
			canCreate,
			errorFlash: readlistErrorFlashMapping(req.query),
		};
	};

	const readlistHoldsAnyArticle = async (params: {
		userId: UserId;
		readlist: ReadlistSlug;
		result: FindArticlesResult;
	}): Promise<boolean> => {
		if (params.result.articles.length > 0) return true;
		const held = await storeFor(params.readlist).countArticlesByUser({
			userId: params.userId,
			countLimit: 1,
		});
		return held > 0;
	};

	/** Renders the full readlist listing from an already-fetched page of rows — the
	 * tail shared by the top-of-page GET and the card-mutation fallback. Never
	 * fetches the listing itself, so GET stays single-fetch and the fallback can
	 * feed it the metadata-only page probe it already holds. */
	const renderReadlistListing = async (
		req: Request,
		res: Response,
		input: {
			userId: UserId;
			context: ReadlistContext;
			result: FindArticlesResult;
			saveError?: string;
			saveErrorCode?: SaveableUrlErrorCode;
			importFlash?: string;
			statusFlash?: StatusFlash;
			importSkipped?: ImportSkippedViewModel;
			saveUrl?: string;
		},
	): Promise<void> => {
		const [summaryByUrl, crawlByUrl, effectiveAccess, readlistHoldsArticles, signals] =
			await Promise.all([
				loadSummaries(deps.findGeneratedSummaries, input.result.articles, deps.logError),
				loadCrawls(deps.findArticleCrawlStatuses, input.result.articles, deps.logError),
				deps.getEffectiveAccess(input.userId),
				readlistHoldsAnyArticle({
					userId: input.userId,
					readlist: input.context.state.readlist,
					result: input.result,
				}),
				resolveOnboardingSignals(req, input.userId),
			]);
		const confirmReadlistLabelsByUrl = await markStatusConfirmLabelsFor({
			userId: input.userId,
			context: input.context,
			urls: input.result.articles.map((article) => article.url),
			acknowledgedAt: signals.markReadAcrossQueuesAckedAt,
		});
		const vm = toReadlistViewModel(input.result, input.context.state, {
			errors: input.saveError ? [{ message: input.saveError }] : undefined,
			saveErrorCode: input.saveErrorCode,
			importFlash: input.importFlash,
			statusFlash: input.statusFlash,
			importSkipped: input.importSkipped,
			summaryByUrl,
			crawlByUrl,
			effectiveAccess,
			now: deps.now(),
			confirmReadlistLabelsByUrl,
			deleteAcknowledged: signals.deleteArticleAckedAt !== undefined,
		});
		const onboarding = signals.onboarding;
		const knownUnreadCount = deriveKnownUnreadCount({
			tab: input.context.state.tab,
			hasMore: input.result.hasMore,
			page: input.result.page,
			pageSize: input.result.pageSize,
			rowsOnPage: input.result.articles.length,
			readlistHoldsArticles,
		});
		const cspNonce = requireCspNonce(req);
		res.vary("Cookie");
		sendComponent(
			req, res,
			FreshForComponent(
				Base(
					ReadlistPage(vm, { onboarding, cspNonce, readlistHoldsArticles, knownUnreadCount, saveUrl: input.saveUrl, deviceClass: classifyDeviceClass(req.get("user-agent")), rail: buildReadlistRail(req, input.context, vm.accessIsReadOnly), saveTip: buildSaveTip(req, { kind: "article", mode: "advisory" }) }),
					await deps.buildBannerState(req, { preFetchedAccess: effectiveAccess }),
				),
				{ ifNoneMatch: req.get("If-None-Match"), cspNonce, cacheControl: "private, max-age=5" },
			),
		);
	};

	/** Answers an htmx card status change. The server — never the client —
	 * decides the response shape from a metadata-only re-probe of the requested
	 * page: an applied change on a page that still has rows removes just the card
	 * (empty primary body) and refreshes toast/counts out of band; anything else
	 * (page emptied, page beyond the last, or the change didn't apply) re-renders
	 * the full listing exactly as the 303 → GET path would, retargeted to <main>
	 * so the DOM resyncs to truth. Delete keeps its full-<main> confirm flow, so
	 * this covers status only. */
	const respondCardStatusSwap = async (
		req: Request,
		res: Response,
		{
			userId,
			statusFlash,
			context,
			resolveFullContext,
		}: {
			userId: UserId;
			statusFlash?: StatusFlash;
			context: ReadlistContext;
			resolveFullContext: () => Promise<ReadlistContext>;
		},
	): Promise<void> => {
		const urlState = context.state;
		const store = storeFor(urlState.readlist);
		const tab = tabQuery(urlState.tab);
		const order = urlState.order ?? tab.defaultOrder;
		const pageSize = readlistPageSizeForClient(req.oauthClientId);
		const probePage = (page: number) =>
			store.findArticlesByUser({
				userId,
				status: tab.status,
				sort: tab.sort,
				order,
				page,
				pageSize,
				excludeContent: true,
			});

		const result = await probePage(urlState.page);
		const rows = result.articles.length;

		/** The card-removal fast path leaves <main> — and so the pagination nav —
		 * untouched, so it is only safe while that nav stays correct. Removing the
		 * card drops the tab total by one, which erases the Next link exactly when
		 * that leaves the current page full with nothing after it: the next page
		 * held the single row this page just absorbed (`rows === pageSize &&
		 * !hasMore`). Treat that like any other DOM drift and fall through to the
		 * full render, which re-renders the nav — the counts loader only re-arms the
		 * unread badge and the "Page X of Y" label, never the Previous/Next links. */
		const paginationWouldDrift = rows === pageSize && !result.hasMore;

		if (statusFlash && rows > 0 && !paginationWouldDrift) {
			res
				.status(200)
				.type("html")
				.send(renderReadlistMutationFragment({ filters: urlState, statusFlash }));
			return;
		}

		let renderState = urlState;
		let renderResult = result;
		if (statusFlash && rows === 0 && urlState.page > 1) {
			const total = await store.countArticlesByUser({ userId, status: tab.status });
			const totalPages = Math.max(1, Math.ceil(total / pageSize));
			renderState = { ...urlState, page: totalPages };
			renderResult = await probePage(totalPages);
		}

		res.set("HX-Retarget", "main");
		res.set("HX-Reswap", "outerHTML show:none");
		res.set("HX-Reselect", "main");
		await renderReadlistListing(req, res, {
			userId,
			context: { ...(await resolveFullContext()), state: renderState },
			result: renderResult,
			statusFlash,
		});
	};

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		/* A native app loads the readlist over Siren on launch; record that authed
		 * request as the "app installed + signed in" signal so step 1 ticks before
		 * any save. Header-gated, so a browser (no header) only ever reads, never
		 * writes. Best-effort: the app's main screen loads over this request, so the
		 * signal write must never be able to fail it. */
		const nativeClient = nativeClientOf(req);
		if (nativeClient) {
			await recordOnboardingSignalBestEffort(() =>
				deps.recordNativeAppAnyActivity({ userId, platform: nativeClient }),
			);
		}
		const siren = wantsSiren(req);
		const context = siren
			? mainlineReadlistContext(req.query)
			: await resolveReadlistContext(req, userId);
		const urlState = context.state;
		const store = storeFor(urlState.readlist);
		const tab = tabQuery(urlState.tab);
		const filterUrl = typeof req.query.url === "string" ? req.query.url : undefined;

		tagPageviewSortOrder(res, urlState.order);
		const order = urlState.order ?? tab.defaultOrder;
		const result = await store.findArticlesByUser({
			userId,
			status: tab.status,
			sort: tab.sort,
			order,
			page: urlState.page,
			pageSize: readlistPageSizeForClient(req.oauthClientId),
			includeTotal: siren,
			excludeContent: true,
		});

		if (siren) {
			const filteredArticles = filterUrl
				? result.articles.filter(a => a.url === filterUrl)
				: result.articles;
			const filtered = filterUrl
				? { ...result, articles: filteredArticles, total: filteredArticles.length }
				: result;
			const crawlByUrl = await loadCrawls(
				deps.findArticleCrawlStatuses,
				filtered.articles,
				deps.logError,
			);

			const appearance = (await deps.findUserById(userId))?.appearance ?? "system";
			setSirenCollectionCaching(req, res);
			res.type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					filtered,
					{
						status: tab.status,
						order: urlState.order,
						page: urlState.page,
						url: filterUrl,
					},
					{
						tabs: READLIST_TAB_STATUSES,
						surfacePlatform: nativeSurfaceOf(req),
						showSaveInProgressNotice: isNativeClient(req) && !hasBackgroundSaveContinuity(req),
						appearance,
						crawlByUrl,
					},
				),
			);
			return;
		}

		/** Marking the last item on a page read (or deleting it, or a stale
		 * bookmark) leaves the requested page beyond the new last page, which the
		 * store answers with zero rows. Clamp at this read boundary so the empty
		 * out-of-bounds render is unreachable by navigation; mutation handlers
		 * stay unchanged because they all redirect back through here. 302 not
		 * 301/308 — the page becomes valid again once the list refills. */
		if (result.articles.length === 0 && urlState.page > 1) {
			const pageRedirect = canonicalReadlistPageRedirect({
				state: urlState,
				total: await store.countArticlesByUser({ userId, status: tab.status }),
				pageSize: result.pageSize,
				extraParams: [
					...collectUtmParams(req.query),
					...collectStatusFlashParams(req.query),
				],
			});
			if (pageRedirect) {
				res.redirect(302, pageRedirect);
				return;
			}
		}

		const saveErrorCode = saveableUrlErrorCodeMapping(req.query);
		const saveError = saveErrorCode
			? saveableUrlErrorMessage(saveErrorCode)
			: deps.httpErrorMessageMapping(req.query);
		if (saveError) res.set("HX-Reswap", "outerHTML show:none");
		const importFlash = importFlashMapping(req.query);
		const statusFlash = statusFlashMapping(req.query);
		const importSkipped = readImportSkippedFlash(req, res);
		await renderReadlistListing(req, res, {
			userId,
			context,
			result,
			saveError,
			saveErrorCode,
			importFlash,
			statusFlash,
			importSkipped,
			saveUrl: filterUrl,
		});
	});

	router.get("/counts", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const context = await resolveReadlistContext(req, userId);
		const urlState = context.state;
		const store = storeFor(urlState.readlist);
		const tab = tabQuery(urlState.tab);
		const tabTotalPromise = store.countArticlesByUser({ userId, status: tab.status });
		const unreadCountPromise =
			tab.status === "unread"
				? tabTotalPromise
				: store.countArticlesByUser({
						userId,
						status: "unread",
						countLimit: UNREAD_BADGE_COUNT_LIMIT,
					});
		const [tabTotal, unreadCount] = await Promise.all([
			tabTotalPromise,
			unreadCountPromise,
		]);
		res.type("html").send(
			renderReadlistCounts(
				toReadlistCountsDisplayModel({
					filters: urlState,
					unreadCount,
					tabTotal,
					pageSize: READLIST_PAGE_SIZE,
				}),
			),
		);
	});

	router.post("/dismiss-onboarding", (req: Request, res: Response) => {
		const version = dismissTokenFor(hasInstallableClient(req));
		res.cookie(DISMISS_COOKIE_NAME, version, { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true });
		const context = requestReadlistContext(req);
		res.redirect(303, buildReadlistUrl(context.state));
	});

	router.post("/onboarding/email/done", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		await deps.recordEmailStepMarkedDone({ userId: req.userId });
		res.redirect(303, buildReadlistUrl(requestReadlistContext(req).state));
	});

	router.post(SAVE_ROUTE.saveArticle, requireNotLocked, deps.requireWriteAccess, express.json(), async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateSaveableUrl(submittedUrl);

		if (validation.status === "ERROR") {
			emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			if (validation.error.code === "malformed_url") {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "invalid-url", message: validation.error.message }),
				);
				return;
			}
			/** Scheme/host that the crawler can't reach (chrome://, file:,
			 * localhost, *.home.arpa, ...). Return the current collection so
			 * the extension can drop the user back into the list view, and
			 * surface a `warning` property carrying the failure code + a
			 * human-readable message that the client can render as a warning
			 * banner alongside the list. */
			const collection = await deps.findArticlesByUser({
				userId,
				includeTotal: true,
				pageSize: readlistPageSizeForClient(req.oauthClientId),
				excludeContent: true,
			});
			const crawlByUrl = await loadCrawls(
				deps.findArticleCrawlStatuses,
				collection.articles,
				deps.logError,
			);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					collection,
					{ page: collection.page },
					{
						tabs: READLIST_TAB_STATUSES,
						warning: { code: validation.error.code, message: validation.error.message },
						surfacePlatform: nativeSurfaceOf(req),
						crawlByUrl,
					},
				),
			);
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const result = await saveArticleAtReadlistTop({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
			});
			await recordSaveSignal(req, res, userId);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
			res.status(201).type(SIREN_MEDIA_TYPE).json(toSavedArticleEntity({ article: result.saved, createdUserArticle: result.createdUserArticle, wroteUserArticle: result.wroteUserArticle }));
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			res.status(500).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-failed", message: "Could not save article" }),
			);
		}
	});

	/** Bulk "Save All Tabs": the extension captures every open tab and hands the
	 * server one multipart request — a JSON `manifest` part listing each page
	 * (`{ url, title?, mediaType? }`) plus a `content-<index>` file part carrying
	 * the captured bytes of every page whose entry declares a `mediaType`. Each
	 * page is classified and saved best-effort:
	 *   - unsaveable scheme (chrome://, file:, private host) → skipped;
	 *   - captured content → staged via the shared save-content handlers, then
	 *     stub-saved so the crawl enriches it (the sized parser limit already
	 *     bounds every content part, so there is no per-page refusal — `tooBig`
	 *     is always empty but stays in the response because deployed extensions'
	 *     response schema requires the field);
	 *   - no captured content (unscriptable or discarded tab) → saved URL-only.
	 * The window is chunked client-side to MAX_PAGES_PER_BULK_SAVE; a request over
	 * that count is rejected early, and saveArticlesLimitHandler turns a body over
	 * the sized parser limit into a Siren 422 rather than an unhandled 413. */
	const saveArticlesUpload = initMultipartUpload({ maxBytes: MAX_UPLOAD_REQUEST_BYTES });
	const saveArticlesLimitHandler = initSaveArticlesLimitHandler({
		logError: deps.logError,
		maxBytes: MAX_UPLOAD_REQUEST_BYTES,
	});
	router.post(SAVE_ROUTE.saveArticles, requireNotLocked, deps.requireWriteAccess, saveArticlesUpload.rawBodyParser, saveArticlesLimitHandler, async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.notSiren);
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsed = saveArticlesUpload.parseAllParts(req);
		if (!parsed.ok) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.invalidManifest);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "invalid-save-articles", message: "save-articles requires a multipart/form-data body" }),
			);
			return;
		}

		const manifestPart = parsed.parts.find((p) => p.name === "manifest" && !p.isFile);
		const manifest = BulkSaveManifestSchema.safeParse(
			manifestPart ? safeJsonParse(manifestPart.content.toString("utf8")) : undefined,
		);
		if (!manifest.success) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.invalidManifest);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "invalid-save-articles", message: "Invalid save-articles manifest" }),
			);
			return;
		}

		if (manifest.data.length > MAX_PAGES_PER_BULK_SAVE) {
			tagSaveRefusal(res, SAVE_REFUSAL_CODES.tooManyPages);
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-articles-too-many-pages", message: `Too many tabs to save in one request (max ${MAX_PAGES_PER_BULK_SAVE})` }),
			);
			return;
		}

		type PageJob =
			| { kind: "content"; index: number; url: SaveableUrl; title?: string; mediaType: string; bytes: Buffer }
			| { kind: "url-only"; index: number; url: SaveableUrl; title?: string };
		type PageOutcome = { index: number; outcome: Exclude<BulkSaveOutcome, "skipped"> };
		const jobs: PageJob[] = [];
		const skipped: { url: string; code: SaveableUrlErrorCode; message: string }[] = [];
		const entryOutcomes: { outcome: BulkSaveOutcome; code?: SaveableUrlErrorCode }[] = [];

		manifest.data.forEach((entry, index) => {
			const validation = deps.validateSaveableUrl(entry.url);
			if (validation.status !== "SUCCESS") {
				skipped.push({ url: entry.url, code: validation.error.code, message: validation.error.message });
				entryOutcomes[index] = { outcome: "skipped", code: validation.error.code };
				return;
			}
			const url = validation.url;
			const mediaType = entry.mediaType;
			/** Only an entry that declares a mediaType carries a content part; a
			 * declared-but-missing part (unscriptable/discarded tab) and an entry
			 * with no mediaType both fall through to a URL-only save. */
			const contentPart = mediaType
				? parsed.parts.find((p) => p.name === `content-${index}` && p.isFile)
				: undefined;
			if (mediaType && contentPart) {
				jobs.push({ kind: "content", index, url, title: entry.title, mediaType, bytes: contentPart.content });
			} else {
				jobs.push({ kind: "url-only", index, url, title: entry.title });
			}
		});

		const failOnePage = (job: PageJob, error: unknown): PageOutcome => {
			deps.logError(`Failed to bulk-save url=${job.url}`, error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			return { index: job.index, outcome: "failed" };
		};

		type PreparedPage = { job: PageJob; freshness: ContentFreshnessResult; canonicalUrl: string };

		const prepareOnePage = async (job: PageJob): Promise<PreparedPage | PageOutcome> => {
			try {
				const [freshness, canonicalUrl] = await Promise.all([
					deps.refreshArticleIfStale({ url: job.url }),
					deps.resolveCanonicalIdentity(job.url),
				]);
				return { job, freshness, canonicalUrl };
			} catch (error) {
				return failOnePage(job, error);
			}
		};

		const writeOnePage = async (page: PreparedPage, savedAt: Date): Promise<PageOutcome> => {
			const { job, freshness } = page;
			try {
				if (job.kind === "content") {
					/** Stage the captured bytes when the media type is supported; an
					 * unsupported type stages nothing and the page is saved URL-only,
					 * so the crawl enriches it the ordinary way. */
					const media = mediaFor({ mediaType: job.mediaType, url: job.url });
					if (media) await media.stageInlineBytes({ url: job.url, bytes: job.bytes, title: job.title, userId });
				}
				const { createdUserArticle } = await saveArticleFromUrl({
					userId,
					url: job.url,
					freshness,
					provenance: resolveSaveProvenance(req.oauthClientId),
					savedAt,
				});
				emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				return { index: job.index, outcome: createdUserArticle ? "created" : "merged" };
			} catch (error) {
				return failOnePage(job, error);
			}
		};

		const findAlreadySaved = async (ready: PreparedPage[]): Promise<Set<string>> => {
			const canonicalUrls = ready.map((page) => page.canonicalUrl);
			try {
				return new Set(await deps.findSavedUrls({ userId, urls: canonicalUrls }));
			} catch (error) {
				deps.logError("Failed to rank a bulk save; keeping manifest order", error instanceof Error ? error : undefined);
				return new Set(canonicalUrls);
			}
		};

		const writeAllPages = async (ready: PreparedPage[]): Promise<PageOutcome[]> => {
			if (ready.length === 0) return [];
			const alreadySavedPending = findAlreadySaved(ready);
			let savedAts: Date[];
			try {
				savedAts = await deps.allocateSavedAtSequence({ userId, count: ready.length });
			} catch (error) {
				await alreadySavedPending;
				return ready.map((page) => failOnePage(page.job, error));
			}
			const alreadySaved = await alreadySavedPending;
			const ranked = rankNewLinksAbove({
				items: ready,
				instants: savedAts,
				isNew: (page) => !alreadySaved.has(page.canonicalUrl),
			});
			return Promise.all(ready.map((page, index) => writeOnePage(page, ranked[index])));
		};

		const prepared = await Promise.all(jobs.map(prepareOnePage));
		const ready = prepared.flatMap((page) => ("outcome" in page ? [] : [page]));
		const prepareFailures = prepared.flatMap((page) => ("outcome" in page ? [page] : []));
		const pageOutcomes = [...prepareFailures, ...(await writeAllPages(ready))];
		const saved = pageOutcomes.filter((o) => o.outcome !== "failed").length;
		const failed = pageOutcomes.filter((o) => o.outcome === "failed").length;

		for (const page of pageOutcomes) {
			entryOutcomes[page.index] = { outcome: page.outcome };
		}
		const results = manifest.data.map((entry, index) => {
			const entryOutcome = entryOutcomes[index];
			assert(entryOutcome, `bulk-save outcome missing for manifest entry ${index}`);
			return { url: entry.url, ...entryOutcome };
		});

		if (saved > 0) markExtensionSavedArticle(res);
		res.status(200).type(SIREN_MEDIA_TYPE).json(
			toBulkSaveResultEntity({
				saved,
				skipped: skipped.length,
				failed,
				tooBig: [],
				skippedUrls: skipped,
				results,
			}),
		);
	});

	/** Unified content entry point. The extension sends captured bytes (HTML or
	 * PDF) together with a `mediaType` hint; the server validates and dispatches
	 * to the existing HTML or PDF pipeline. */
	const contentUpload = initMultipartUpload({ maxBytes: MAX_UPLOAD_REQUEST_BYTES });
	const saveContentLimitHandler = initSaveContentLimitHandler({
		logError: deps.logError,
		maxBytes: MAX_UPLOAD_REQUEST_BYTES,
	});

	router.post(
		SAVE_ROUTE.saveContent,
		requireNotLocked,
		deps.requireWriteAccess,
		contentUpload.rawBodyParser,
		saveContentLimitHandler,
		async (req: Request, res: Response) => {
			if (!wantsSiren(req)) {
				res.status(406).send("Not Acceptable");
				return;
			}

			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;

			const buildFallbackAction = () => ({
				name: "save-article",
				title: "Save a link",
				href: READLIST_PATH,
				method: "POST",
				type: "application/json",
				fields: [{ name: "url", type: "url" }],
			});
			const parsed = contentUpload.parseAllParts(req);
			if (!parsed.ok) {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({
						code: "invalid-save-content",
						message: "save-content requires a multipart/form-data body",
						actions: [buildFallbackAction()],
					}),
				);
				return;
			}

			const textPart = (name: string): string | undefined => {
				const part = parsed.parts.find((p) => p.name === name && !p.isFile);
				return part ? part.content.toString("utf8") : undefined;
			};
			const contentBytes = parsed.parts.find((p) => p.name === "content" && p.isFile)?.content;
			const submittedUrl = textPart("url") ?? "";
			const mediaType = textPart("mediaType") ?? "";
			const title = textPart("title");
			const uploaded = textPart("uploaded");
			const sizeRaw = textPart("size");
			const size = sizeRaw !== undefined ? Number(sizeRaw) : Number.NaN;

			const refuse = (message: string, code = "invalid-save-content") => {
				emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code, message, actions: [buildFallbackAction()] }),
				);
			};

			const resolveTarget = (): { articleUrl: SaveableUrl; normalized: string; media: SaveContentMedia } | undefined => {
				if (!mediaType) {
					refuse("save-content requires a mediaType field");
					return undefined;
				}
				const validation = deps.validateSaveableUrl(submittedUrl);
				if (validation.status === "ERROR") {
					refuse(validation.error.message);
					return undefined;
				}
				if (isNonArticleHost(validation.url)) {
					refuse(
						"This link isn't an article, so the page capture wasn't kept",
						"capture-not-allowed",
					);
					return undefined;
				}
				const normalized = normalizeMediaType(mediaType);
				const media = saveContentMedia[normalized];
				if (!media) {
					refuse(`Unsupported media type: ${mediaType}`, "unsupported-media-type");
					return undefined;
				}
				return { articleUrl: validation.url, normalized, media };
			};

			const finishSave = async (articleUrl: SaveableUrl): Promise<void> => {
				const freshness = await deps.refreshArticleIfStale({ url: articleUrl });
				const result = await attachArticleContent({
					userId,
					url: articleUrl,
					freshness,
					provenance: resolveSaveProvenance(req.oauthClientId),
					savedAt: await deps.allocateSavedAt({ userId }),
				});
				await recordSaveSignal(req, res, userId);
				emitSaveIntent({ req, url: articleUrl, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				res.status(201).type(SIREN_MEDIA_TYPE).json(toSavedArticleEntity({ article: result.saved, createdUserArticle: result.createdUserArticle, wroteUserArticle: result.wroteUserArticle }));
			};

			try {
				if (contentBytes && contentBytes.length > 0) {
					if (!mediaType) {
						refuse("save-content requires a mediaType field");
						return;
					}
					const validation = deps.validateSaveableUrl(submittedUrl);
					if (validation.status === "ERROR") {
						refuse(validation.error.message);
						return;
					}
					const media = mediaFor({ mediaType, url: validation.url });
					if (media) {
						await media.stageInlineBytes({ url: validation.url, bytes: contentBytes, title, userId });
					}
					await finishSave(validation.url);
					return;
				}

				if (uploaded === "true") {
					const target = resolveTarget();
					if (!target) return;
					const stat = await deps.statPendingUpload({ url: target.articleUrl, mediaType: target.normalized });
					if (!stat) {
						refuse("No uploaded content found for this URL", "upload-not-found");
						return;
					}
					if (stat.byteLength > target.media.uploadCeilingBytes) {
						refuse(`Content upload exceeded ${bytesToMb(target.media.uploadCeilingBytes)} MB`, "content-too-large");
						return;
					}
					const ageSeconds = (deps.now().getTime() - stat.lastModified.getTime()) / 1000;
					if (ageSeconds > UPLOAD_COMPLETION_MAX_AGE_SECONDS) {
						refuse("The uploaded content has expired; please re-upload", "upload-not-found");
						return;
					}
					const admitted = await target.media.admitUploadedBytes({
						url: target.articleUrl,
						mediaType: target.normalized,
						title,
						userId,
					});
					if (!admitted.ok) {
						refuse(admitted.message, admitted.code);
						return;
					}
					await finishSave(target.articleUrl);
					return;
				}

				if (Number.isInteger(size) && size > 0) {
					const target = resolveTarget();
					if (!target) return;
					if (size > target.media.uploadCeilingBytes) {
						refuse(`Content upload exceeded ${bytesToMb(target.media.uploadCeilingBytes)} MB`, "content-too-large");
						return;
					}
					const slot = await deps.createUploadSlot({ url: target.articleUrl, mediaType: target.normalized, byteLength: size });
					res.status(200).type(SIREN_MEDIA_TYPE).json(
						toUploadSlotEntity({
							uploadUrl: slot.uploadUrl,
							expiresAt: slot.expiresAt,
							url: target.articleUrl,
							mediaType: target.normalized,
							title,
							completionHref: `${READLIST_PATH}${SAVE_ROUTE.saveContent}`,
						}),
					);
					return;
				}

				refuse("save-content requires a content field, a size to request an upload slot, or uploaded=true to complete an upload");
			} catch (error) {
				deps.logError("Failed to save article from content", error instanceof Error ? error : undefined);
				const intent = deps.validateSaveableUrl(submittedUrl);
				if (intent.status === "SUCCESS") {
					emitSaveIntent({ req, url: intent.url, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
				}
				res.status(500).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "save-failed", message: "Could not save article" }),
				);
			}
		},
	);

	router.post(SAVE_ROUTE.save, requireNotLocked, deps.requireWriteAccess, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		markSaveTipSeen(res, { secureCookies: deps.secureCookies });
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateSaveableUrl(submittedUrl);
		const saveState = parseReadlistUrl({});

		if (validation.status === "ERROR") {
			emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.error });
			res.redirect(303, buildReadlistUrl(saveState, [["error_code", validation.error.code]]));
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			await saveArticleAtReadlistTop({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
			});
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.saved });
			res.redirect(303, `${buildReadlistUrl(saveState)}#latest-saved`);
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.readlistSaveBar, outcome: SAVE_OUTCOMES.error });
			res.redirect(303, buildReadlistUrl(saveState, [["error_code", "save_failed"]]));
		}
	});

	router.post("/queues", requireNotLocked, deps.requireWriteAccess, async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const context = await resolveReadlistContext(req, userId);
		const slug = generateReadlistSlug();
		const label = defaultReadlistLabel(context.readlists.map((readlist) => readlist.label));

		try {
			await deps.createReadlistDefinition({
				userId,
				slug,
				label,
				createdAt: deps.now(),
			});
		} catch (error) {
			if (!(error instanceof ReadlistLimitReachedError)) throw error;
			res.redirect(
				303,
				buildReadlistUrl(context.state, [
					["queue_error", READLIST_ERROR_LIMIT],
				]),
			);
			return;
		}

		res.redirect(303, buildReadlistUrl({ readlist: slug }));
	});

	router.post(
		"/queues/:slug/rename",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const reject = (reason: ReadlistRenameRejection): void => {
				const { status, error, message } = READLIST_RENAME_REJECTIONS[reason];
				res.status(status).json({ error, message });
			};
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				reject("unknown-readlist");
				return;
			}
			const definitions = await deps.listReadlistDefinitions(userId);
			const decision = decideReadlistRename({
				slug: requested.data,
				label: typeof req.body?.label === "string" ? req.body.label : "",
				readlists: readerReadlists(definitions),
			});
			if (!decision.ok) {
				reject(decision.reason);
				return;
			}
			const { renamed } = await deps.renameReadlistDefinition({
				userId,
				slug: decision.slug,
				label: decision.label,
			});
			if (!renamed) {
				reject("unknown-readlist");
				return;
			}
			res.json({ slug: decision.slug, label: decision.label });
		},
	);

	router.post(
		"/queues/:slug/delete",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const context = await resolveReadlistContext(req, userId);
			const unknownReadlist = () => {
				res.redirect(
					303,
					buildReadlistUrl({}, [
						["queue_error", READLIST_ERROR_UNKNOWN_READLIST],
					]),
				);
			};
			const requested = ReadlistSlugSchema.safeParse(req.params.slug);
			if (!requested.success) {
				unknownReadlist();
				return;
			}
			const decision = decideReadlistDelete({
				slug: requested.data,
				readlists: context.readlists,
			});
			if (!decision.ok) {
				unknownReadlist();
				return;
			}
			const requestedDestination = ReadlistSlugSchema.safeParse(req.body?.migrate_to);
			if (requestedDestination.success) {
				const migration = decideReadlistMigration({
					from: decision.slug,
					to: requestedDestination.data,
					readlists: context.readlists,
				});
				if (!migration.ok) {
					unknownReadlist();
					return;
				}
				await deps.moveReadlistArticles({ userId, from: migration.from, to: migration.to });
			}
			await purgeReadlistArticles({ userId, readlist: decision.slug });
			const { deleted } = await deps.deleteReadlistDefinition({ userId, slug: decision.slug });
			if (!deleted) {
				unknownReadlist();
				return;
			}
			res.redirect(
				303,
				buildReadlistUrl({
					readlist: readlistAfterDelete({ viewed: context.activeReadlist.slug, deleted: decision.slug }),
				}),
			);
		},
	);

	router.get("/:id/summary", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(404).type("html").send("");
			return;
		}

		await deps.markArticleViewed({ userId, url: article.url, at: deps.now() });

		const pollCount = parsePollParam(req.query.poll, MAX_POLLS);
		const readlistFiling = await readerReadlistFilingFor({
			userId,
			article,
			returnTo: readerReturnPath(req, article.id.value),
		});
		const component = await reader.handleSummaryPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(req, article.id.value),
			capturing: parseCapturingFlag(req.query.capturing),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${READLIST_PATH}/${article.id.value}/summary-toggle`,
			provenance: article.provenance,
			readlistTags: readlistFiling.tags,
			readerViewFailedOob: ownerReaderViewFailedOob(req),
		});
		sendComponent(req, res, CacheableComponent(component, req));
	});

	router.get("/:id/reader", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(404).type("html").send("");
			return;
		}

		await deps.markArticleViewed({ userId, url: article.url, at: deps.now() });

		const pollCount = parsePollParam(req.query.poll, MAX_POLLS);
		const readlistFiling = await readerReadlistFilingFor({
			userId,
			article,
			returnTo: readerReturnPath(req, article.id.value),
		});
		const component = await reader.handleReaderPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(req, article.id.value),
			capturing: parseCapturingFlag(req.query.capturing),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${READLIST_PATH}/${article.id.value}/summary-toggle`,
			provenance: article.provenance,
			readlistTags: readlistFiling.tags,
			readerViewFailedOob: ownerReaderViewFailedOob(req),
		});
		sendComponent(req, res, CacheableComponent(component, req));
	});

	router.get("/:id/related", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(404).type("html").send("");
			return;
		}

		const returnTo = `${READLIST_PATH}/${article.id.value}/view`;

		const pollCount = parsePollParam(req.query.poll, MAX_POLLS);
		const html = renderNextRead({
			related: {
				articles: await loadRelatedArticles(
					deps.findRelatedArticles,
					article,
					deps.logError,
				),
				sourceArticleId: article.id.value,
				now: deps.now(),
				dismissal: nextReadDismissalOf(article),
			},
			pollUrl:
				pollCount < MAX_POLLS
					? relatedPollUrlFor(article.id.value, pollCount + 1)
					: undefined,
			returnTo,
		});
		sendComponent(req, res, CacheableComponent(HtmlPage(html), req));
	});

	router.post("/:id/related-dismiss", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (article) {
			const suggestionId = ReaderArticleHashIdSchema.safeParse(req.body.suggestionId);
			await deps.markRelatedDismissed({
				userId,
				url: article.url,
				at: deps.now(),
				suggestionId: suggestionId.success ? suggestionId.data : undefined,
			});
		}

		res.redirect(303, safeReturnPath(req.body.returnTo));
	});

	/** Fire-and-forget beacon target for the TL;DR open/close toggle. Records the
	 * latest state on the per-user row (last-write-wins) and emits a
	 * `summary_toggled` analytics event. Always answers 204 with no body — a
	 * beacon must never surface an error to the page — so an unparseable/absent
	 * `state` is a silent no-op rather than a 4xx. */
	router.post("/:id/summary-toggle", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(404).type("html").send("");
			return;
		}

		const parsedState = z.enum(["open", "closed"]).safeParse(req.query.state);
		if (!parsedState.success) {
			res.status(204).end();
			return;
		}

		await deps.markSummaryToggled({
			userId,
			url: article.url,
			state: parsedState.data,
			at: deps.now(),
		});
		deps.recordAnalyticsEvent(req, {
			stream: STREAMS.analytics,
			event: ANALYTICS_EVENTS.summaryToggled,
			timestamp: deps.now().toISOString(),
			user_id: userId,
			state: parsedState.data,
			visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
		});
		res.status(204).end();
	});

	router.get("/:id/card", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(404).type("html").send("");
			return;
		}

		const [crawl, summary] = await Promise.all([
			deps.findArticleCrawlStatus(article.url),
			deps.findGeneratedSummary(article.url),
		]);

		const etag = computeReadlistCardEtag({ article, crawl, summary });
		/** Per-user data — never share across CDN edges or between users on a
		 * shared cache. `no-cache` requires revalidation on every request, which
		 * is exactly what we want: the browser always asks, the server cheaply
		 * returns 304 when the row hasn't changed during the wait window. */
		res.set("Cache-Control", "private, no-cache");
		res.set("Vary", "Cookie");
		res.set("ETag", etag);

		if (etagMatches(req.get("If-None-Match"), etag)) {
			res.status(304).end();
			return;
		}

		const filters = parseReadlistUrl(req.query);
		const readlistUrl = buildReadlistUrl(filters);
		const queryIndex = readlistUrl.indexOf("?");
		const returnQuery = queryIndex !== -1 ? readlistUrl.slice(queryIndex) : "";
		const requestedPoll = parsePollParam(req.query.poll, MAX_POLLS);
		/** The fragment must agree with the listing it replaces a row in: a card
		 * still polling when the reader silences the delete confirmation would
		 * otherwise come back pointing at a panel the page no longer renders,
		 * leaving its Delete button inert. */
		const signals = await deps.getOnboardingSignals({ userId });
		const confirmReadlistLabelsByUrl = await markStatusConfirmLabelsFor({
			userId,
			context: await resolveReadlistContext(req, userId),
			urls: [article.url],
			acknowledgedAt: signals.markReadAcrossQueuesAckedAt,
		});
		const articleVm = toReadlistArticleViewModel({
			article,
			now: deps.now(),
			returnQuery,
			summary,
			crawl,
			filters,
			pollCount: requestedPoll + 1,
			maxPolls: MAX_POLLS,
			confirmReadlistLabels: confirmReadlistLabelsByUrl?.get(article.url),
			deleteAcknowledged: signals.deleteArticleAckedAt !== undefined,
		});
		const html = renderReadlistCard(
			toReadlistCardDisplayModel(articleVm, {
				isFirst: false,
				deviceClass: classifyDeviceClass(req.get("user-agent")),
			}),
		);
		res.status(200).type("html").send(html);
	});

	router.post("/:id/status", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const parsedStatus = ArticleStatusSchema.safeParse(req.body.status);
		const context = requestReadlistContext(req);

		if (req.body?.ack === MARK_STATUS_ACK_NEVER) {
			await deps.recordMarkReadAcrossQueuesAcknowledged({ userId });
		}

		let statusFlash: StatusFlash | undefined;
		const flashParams: [string, string][] = [];
		if (parsedId.success && parsedStatus.success) {
			const updated = await deps.updateArticleStatusAcrossReadlists({
				id: parsedId.data,
				userId,
				addressed: context.state.readlist,
				status: parsedStatus.data,
			});
			if (updated) {
				statusFlash = statusFlashFor({ articleId: req.params.id, changed: parsedStatus.data });
				flashParams.push(["status_changed", parsedStatus.data]);
				flashParams.push(["status_article", req.params.id]);
			}
			if (updated && parsedStatus.data === "read") {
				deps.recordAnalyticsEvent(req, {
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.articleRead,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: viewerOf(req).ip, salt: deps.salt }),
					device_class: classifyDeviceClass(req.get("user-agent")),
				});
			}
		}

		if (req.get("HX-Request") === "true" && req.query.swap === "card") {
			/** The fallback branch re-renders the whole listing, rail included, so
			 * that render needs the reader's real readlists — the shape-only context
			 * above knows the addressed slug but not the set it belongs to. */
			await respondCardStatusSwap(req, res, {
				userId,
				statusFlash,
				context,
				resolveFullContext: () => resolveReadlistContext(req, userId),
			});
			return;
		}

		res.redirect(303, buildReadlistUrl(context.state, [...collectUtmParams(req.query), ...flashParams]));
	});

	router.post("/:id/delete", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);

		if (req.body?.ack === DELETE_ACK_NEVER) {
			await deps.recordDeleteArticleAcknowledged({ userId });
		}

		const context = requestReadlistContext(req);
		if (parsedId.success) {
			await deleteArticleFromReadlistFor(context.state.readlist)({ articleId: parsedId.data, userId });
		}

		res.redirect(303, buildReadlistUrl(context.state));
	});

	router.post(
		"/:id/assign",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request<{ id: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
			const parsedReadlist = ReadlistSlugSchema.safeParse(req.body?.queue);
			if (!parsedId.success || !parsedReadlist.success || parsedReadlist.data === DEFAULT_READLIST_SLUG) {
				res.status(404).type("html").send("");
				return;
			}
			const definitions = await deps.listReadlistDefinitions(userId);
			const target = definitions.find((definition) => definition.slug === parsedReadlist.data);
			if (!target) {
				res.status(404).type("html").send("");
				return;
			}
			const article = await deps.findArticleById(parsedId.data, userId);
			if (article) {
				const savedAt = await deps.allocateSavedAt({ userId });
				await deps.assignSavedArticleToReadlist({
					userId,
					readlist: target.slug,
					url: article.url,
					savedAt,
				});
			}
			res.redirect(303, safeReturnPath(req.body.returnTo));
		},
	);

	router.post(
		"/:id/create-and-assign",
		requireNotLocked,
		deps.requireWriteAccess,
		async (req: Request<{ id: string }>, res: Response) => {
			assert(req.userId, "userId required - route must be protected by requireAuth");
			const userId = req.userId;
			const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
			if (!parsedId.success) {
				res.status(404).type("html").send("");
				return;
			}
			const article = await deps.findArticleById(parsedId.data, userId);
			if (article) {
				const definitions = await deps.listReadlistDefinitions(userId);
				const decision = decideReadlistCreate({
					label: typeof req.body?.label === "string" ? req.body.label : "",
					slug: generateReadlistSlug(),
					readlists: readerReadlists(definitions),
				});
				if (decision.ok) {
					try {
						if (decision.create) {
							await deps.createReadlistDefinition({
								userId,
								slug: decision.slug,
								label: decision.create.label,
								createdAt: deps.now(),
							});
						}
						await deps.assignSavedArticleToReadlist({
							userId,
							readlist: decision.slug,
							url: article.url,
							savedAt: await deps.allocateSavedAt({ userId }),
						});
					} catch (error) {
						if (!(error instanceof ReadlistLimitReachedError)) throw error;
					}
				}
			}
			res.redirect(303, safeReturnPath(req.body?.returnTo));
		},
	);

	router.post("/:id/unassign", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const parsedReadlist = ReadlistSlugSchema.safeParse(req.body?.queue);
		if (parsedId.success && parsedReadlist.success && parsedReadlist.data !== DEFAULT_READLIST_SLUG) {
			await deleteArticleFromReadlistFor(parsedReadlist.data)({ articleId: parsedId.data, userId });
		}
		res.redirect(303, safeReturnPath(req.body.returnTo));
	});

	/** Remove one crawl-version snapshot the viewer authored. Guardless (only
	 * dualAuth + resolveVerificationStatus, matching `/delete`): removing content
	 * you authored is a deletion right, reachable for read-only/locked users. The
	 * publisher only ever deletes objects whose sidecar/log entry credits this
	 * userId, so a forged id/version resolves to nothing server-side. */
	router.post("/:id/remove-my-version", async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const parsedVersion = CrawlVersionMinuteIdSchema.safeParse(req.body?.versionMinuteId);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (article && parsedVersion.success) {
			await deps.publishRemoveMyContent({
				url: article.url,
				userId,
				versionMinuteId: parsedVersion.data,
			});
			res.redirect(303, `${READLIST_PATH}/${article.id.value}/view`);
			return;
		}

		res.redirect(303, `${READLIST_PATH}/${req.params.id}/view`);
	});

	return router;
}
