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
import type { HutchLogger } from "@packages/hutch-logger";
import type { SaveableUrl, ValidateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { BulkSaveManifestSchema, MAX_PAGES_PER_BULK_SAVE, MAX_UPLOAD_REQUEST_BYTES, MAX_UPLOAD_HTML_BYTES, ArticleStatusSchema, saveableUrlErrorMessage } from "@packages/domain/article";
import { buildSaveIntentEvent, classifyDeviceClass, hashIp, type AnalyticsEvent } from "@packages/web-analytics";
import { ANALYTICS_EVENTS, SAVE_OUTCOMES, SAVE_SURFACES, STREAMS, type SaveOutcome, type SaveSurface } from "../../../observability/events";
import {
	IMPORT_SKIPPED_COOKIE_NAME,
	decodeImportSkippedCookie,
} from "../import/import-skipped-cookie";
import type { ImportSkippedViewModel } from "./queue.viewmodel";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { RefreshArticleIfStale } from "@packages/provider-contracts/article-freshness";
import type {
	CountArticlesByUser,
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	FindArticleUrlById,
	FindArticlesByUser,
	MarkArticleViewed,
	MarkRelatedDismissed,
	MarkSummaryToggled,
	SaveArticle,
	UpdateArticleStatus,
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
import { isPDF, MAX_PDF_BYTES } from "@packages/crawl-article";
import { initMultipartUpload } from "../import/multipart-upload";
import { UPLOAD_COMPLETION_MAX_AGE_SECONDS } from "./upload-slot-ttl";
import { initSaveContentLimitHandler } from "./save-content-limit-handler";
import { initSaveArticlesLimitHandler } from "./save-articles-limit-handler";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
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
import type { PollUrlBuilder } from "../../shared/article-reader/article-reader.types";
import type {
	PublishLinkDequeued,
	PublishLinkQueued,
	PublishLinkSaved,
} from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import {
	initDeleteArticleFromQueue,
	initSaveArticleFromUrl,
	initSaveArticleInteractively,
} from "@packages/save-article";
import type { PublishComputeRelatedArticles } from "@packages/provider-contracts/events";
import type {
	FindRelatedArticles,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import { Base, ChromelessPage } from "../../base.component";
import { NotFoundPage } from "../not-found";
import type { BuildBannerState } from "../../banner-state";
import { selectChangelogBanner } from "../../banner-state";
import type { GetChangelogBanner } from "../../changelog-banner-source";
import { requireCspNonce, sendComponent } from "@packages/web-shell";
import type { CspNonce } from "@packages/web-shell";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { RedirectComponent, type Redirect } from "../../redirect.component";
import { CacheableComponent } from "../../conditional-get";
import { isFullyParsed } from "../../shared/article-state/is-fully-parsed";
import { initReaderPermalink } from "./reader-permalink";
import { wantsSiren } from "../../content-negotiation";
import type { QuerystringFeatureToggle } from "@packages/web-shell";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { toBulkSaveResultEntity } from "../../api/bulk-save-siren";
import { toSavedArticleEntity } from "../../api/article-siren";
import { toUploadSlotEntity } from "../../api/upload-slot-siren";
import { activeQueueTab, type QueueTab } from "./queue-tab";
import { parseQueueUrl, buildQueueUrl, QUEUE_PATH, canonicalQueuePageRedirect } from "./queue.url";
import { collectUtmParams } from "../../shared/utm";
import { tabQuery } from "./queue.tabs";
import { QUEUE_PAGE_SIZE, queuePageSizeForClient } from "./queue-page-size";
import { resolveSaveProvenance } from "../../shared/save-provenance";
import type { HttpErrorMessageMapping } from "./queue.error";
import { collectStatusFlashParams, importFlashMapping, statusFlashMapping } from "./queue.error";
import { HtmlPage } from "@packages/web-shell";
import { MAX_POLLS } from "@packages/web-shell";
import { parsePollParam } from "@packages/web-shell";
import { toQueueArticleViewModel, toQueueViewModel } from "./queue.viewmodel";
import { QueuePage } from "./queue.component";
import {
	UNREAD_BADGE_COUNT_LIMIT,
	renderQueueCounts,
	toQueueCountsDisplayModel,
} from "./queue-counts.component";
import {
	renderQueueCard,
	toQueueCardDisplayModel,
} from "./queue-card/queue-card.component";
import { computeQueueCardEtag } from "./queue-card/queue-card.etag";
import { etagMatches } from "@packages/web-shell";
import { ReaderPage, formatReaderDocumentTitle } from "../reader/reader.component";
import { renderNextRead } from "../../shared/next-read/next-read.component";
import { safeReturnPath } from "../../shared/safe-return-path";
import { NO_CLIENT_ONBOARDING_VERSION, ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import {
	detectPlatform,
	extensionInstallUrlIfMissing,
	hasInstallableClient,
	isExtensionInstalled,
	isExtensionSavedArticle,
} from "../../onboarding/extension-install";
import { hasBackgroundSaveContinuity, isIosClient, isIosSurface } from "../../onboarding/ios-client";
import { APP_BACK_LINK } from "../../shared/ios-app-links";
import type { GetIosAppSignals, RecordIosAnyActivity, RecordIosSavedArticle } from "@packages/provider-contracts/ios-onboarding-signal";
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
	res.clearCookie(IMPORT_SKIPPED_COOKIE_NAME, { path: QUEUE_PATH });
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

interface QueueDependencies {
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
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
	markSummaryToggled: MarkSummaryToggled;
	markRelatedDismissed: MarkRelatedDismissed;
	publishLinkSaved: PublishLinkSaved;
	publishLinkQueued: PublishLinkQueued;
	publishLinkDequeued: PublishLinkDequeued;
	publishComputeRelatedArticles: PublishComputeRelatedArticles;
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
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	publishUpdateFetchTimestamp: PublishUpdateFetchTimestamp;
	readArticleContent: ReadArticleContent;
	/** The reader's Back + Mark-as-read action bar, injected per variant: the sticky
	 * toolbar for the web reader, the chromeless sticky variant for the iOS app. Both
	 * pin the toolbar and drop the bottom bar; they differ only in where it pins. */
	stickyReader: RenderReaderActions;
	chromelessReader: RenderReaderActions;
	httpErrorMessageMapping: HttpErrorMessageMapping;
	/** Reads the per-user iOS onboarding signals for the Safari `/queue` render
	 * when the visitor is on an iPhone (where completion can't come from cookies
	 * because Safari can't see the app's cookie jar). */
	getIosAppSignals: GetIosAppSignals;
	/** Marks the user "installed" when an authenticated iOS request carries the
	 * client header — the cross-app-cookie-jar substitute for the extension's
	 * liveness cookie. */
	recordIosAnyActivity: RecordIosAnyActivity;
	/** Marks the user's first iOS save when a save request carries the client
	 * header — the substitute for the extension's save cookie. */
	recordIosSavedArticle: RecordIosSavedArticle;
	tabs: readonly QueueTab[];
	/** Auth middleware applied to every queue route except the public
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
	getEffectiveAccess: GetEffectiveAccess;
	buildBannerState: BuildBannerState;
	/** The site-wide announcement, for the chromeless reader only. The full shell
	 * reaches it through `buildBannerState`; the chromeless branch takes it directly
	 * so an in-app article open doesn't pay for the trial/access lookup that
	 * `buildBannerState` also performs and this shell has nowhere to render. */
	getChangelogBanner: GetChangelogBanner;
	logError: (message: string, error?: Error) => void;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	featureToggle: QuerystringFeatureToggle;
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

export const RELATED_FEATURE = "similar";

const relatedPollUrlFor = (articleId: string, pollCount: number): string =>
	`${QUEUE_PATH}/${articleId}/related?feature=${RELATED_FEATURE}&poll=${pollCount}`;

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

const SAVE_ROUTE = {
	saveArticle: "/",
	saveArticles: "/save-articles",
	save: "/save",
	saveContent: "/save-content",
} as const;

/** Root ("/") maps to QUEUE_PATH alone; appending it would record a spurious "/queue/" trailing slash. */
const saveIntentPath = (route: string): string =>
	route === "/" ? QUEUE_PATH : `${QUEUE_PATH}${route}`;

const SAVE_INTENT_PATH = {
	saveArticle: saveIntentPath(SAVE_ROUTE.saveArticle),
	saveArticles: saveIntentPath(SAVE_ROUTE.saveArticles),
	save: saveIntentPath(SAVE_ROUTE.save),
	saveContent: saveIntentPath(SAVE_ROUTE.saveContent),
} as const;

const VIEW_BACK_LINK = {
	topHref: "/queue?utm_source=reader&utm_medium=internal&utm_content=back-top",
	label: "Back to queue",
} as const;

/** Server-authored bridge for the iOS in-app reader: when the reader's mark-read
 * htmx request completes, tell the WKWebView so the native app closes the sheet
 * and reconciles its list. Guarded on the WKWebView message handler, so it is inert
 * in a normal browser that renders this same reader. Keeping the htmx detail here —
 * rather than injected by the app — keeps the htmx coupling on the server that owns
 * htmx; the app only registers the `readplaceReader` handler and reacts to the
 * `markedRead` message, with no knowledge of the front-end's event shape. */
const readerMarkReadBridgeScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {
	var handlers = window.webkit && window.webkit.messageHandlers;
	if (!handlers || !handlers.readplaceReader) { return; }
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
		handlers.readplaceReader.postMessage({ type: "markedRead" });
	});
})();
</script>`;

const readerCaptureBridgeScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {
	var handlers = window.webkit && window.webkit.messageHandlers;
	if (!handlers || !handlers.readplaceReader) { return; }
	document.documentElement.setAttribute("data-reader-capture-host", "");
	document.body.addEventListener("click", function (event) {
		var target = event.target;
		var button = target && target.closest ? target.closest("[data-reader-capture]") : null;
		if (!button) { return; }
		button.disabled = true;
		handlers.readplaceReader.postMessage({ type: "captureBlocked" });
		var pollUrl = button.getAttribute("data-reader-capture-poll");
		if (!pollUrl || !window.htmx) { return; }
		window.htmx.ajax("GET", pollUrl, { target: "#article-body-reader-slot", swap: "outerHTML" });
	});
})();
</script>`;

/** True when the client wants the app's chromeless reader rather than the full web
 * shell — chosen by an explicit client signal, never a user-agent sniff. The app
 * appends `?platform=ios` to the `read` link it loads in its WKWebView; the
 * `x-readplace-client` header is honoured alongside it so a store-reviewed build
 * predating the query param — which cannot deploy in lockstep with the server —
 * still resolves to its chromeless reader. */
const isIosPlatform = (req: Request): boolean => isIosSurface(req);

export function initQueueRoutes(deps: QueueDependencies): Router {
	const router = express.Router();
	// Every save this router serves is a person acting: the save bar, the
	// extension, Save All Tabs, a capture. The bare save (import commits, inbox
	// auto-saves) stays in @packages/save-article and never asks for relations.
	const saveArticleFromUrl = initSaveArticleInteractively({
		saveArticleFromUrl: initSaveArticleFromUrl(deps),
		publishComputeRelatedArticles: deps.publishComputeRelatedArticles,
	});
	const deleteArticleFromQueue = initDeleteArticleFromQueue(deps);

	/** The iOS onboarding signal is non-essential bookkeeping that sits on the
	 * critical path of the app's queue load and every save. Unlike the extension's
	 * equivalent — a Set-Cookie header that cannot fail — this write hits DynamoDB
	 * and can throw (a transient error, or `assert(row)` firing for a token that
	 * outlived a deleted account). Swallow and log so the bookkeeping can never
	 * turn a successful save into a 500 or break the iPhone app's queue load; the
	 * signal is allowed to lag a render and catch up on the next request. */
	const recordIosSignalBestEffort = async (record: () => Promise<void>): Promise<void> => {
		try {
			await record();
		} catch (error) {
			deps.logError(
				"Failed to record iOS onboarding signal",
				error instanceof Error ? error : undefined,
			);
		}
	};

	/** Records that the user saved their first article. From the iOS app (client
	 * header present) this is a per-user server-side write so Safari's `/queue`
	 * can read it; from the extension it is the same-browser-jar liveness cookie. */
	const recordSaveSignal = async (req: Request, res: Response, userId: UserId): Promise<void> => {
		if (isIosClient(req)) {
			await recordIosSignalBestEffort(() => deps.recordIosSavedArticle({ userId }));
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
		deps.analytics.info(buildSaveIntentEvent({ now: deps.now, salt: deps.salt }, params));
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
			uploadCeilingBytes: MAX_UPLOAD_HTML_BYTES,
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
	const resolveReaderPermalink = initReaderPermalink({
		findArticleById: deps.findArticleById,
		findArticleUrlById: deps.findArticleUrlById,
		findArticleByUrl: deps.findArticleByUrl,
	});

	function pollUrlBuilderForId(articleId: string): PollUrlBuilder {
		return {
			summary: (n) => `${QUEUE_PATH}/${articleId}/summary?poll=${n}`,
			reader: (n, capturing) =>
				`${QUEUE_PATH}/${articleId}/reader?poll=${n}${capturing ? "&capturing=1" : ""}`,
		};
	}

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
		res.redirect(301, `${QUEUE_PATH}/${req.params.id}/view${queryString}`);
	});

	type ResolvedReaderState = Awaited<ReturnType<typeof reader.resolveReaderState>>;
	type OwnerReaderResolution =
		| { kind: "redirect"; redirect: Redirect }
		| { kind: "not-found" }
		| {
				kind: "ready";
				article: SavedArticle;
				state: ResolvedReaderState;
				audioEnabled: boolean;
				related: RelatedArticles | undefined;
				relatedPollUrl: string | undefined;
			};

	/** Ownership/access (owner → reader; non-owner or anonymous → permalink
	 * redirect) comes entirely from resolveReaderPermalink, so both the full-shell
	 * and the `?platform=ios` chromeless renders of `/view` inherit it identically.
	 * Stamps reader-view presence on the owner open — the only server-side signal
	 * that the reader was opened. */
	const resolveOwnerReader = async (
		req: Request<{ id: string }>,
	): Promise<OwnerReaderResolution> => {
		const result = await resolveReaderPermalink({
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

		await deps.markArticleViewed({
			userId: ownedArticle.userId,
			url: ownedArticle.url,
			at: deps.now(),
		});

		const audioEnabled = deps.featureToggle.isEnabled(req, "audio");
		const relatedActive =
			deps.featureToggle.isEnabled(req, RELATED_FEATURE) &&
			ownedArticle.relatedDismissedAt === undefined;
		const [related, state] = await Promise.all([
			relatedActive
				? loadRelatedArticles(deps.findRelatedArticles, ownedArticle, deps.logError)
				: Promise.resolve(undefined),
			reader.resolveReaderState({
				article: {
					url: ownedArticle.url,
					metadata: ownedArticle.metadata,
					estimatedReadTime: ownedArticle.estimatedReadTime,
				},
				pollUrlBuilder: pollUrlBuilderForId(ownedArticle.id.value),
				capturing: false,
			}),
		]);
		const relatedPollUrl = relatedActive
			? relatedPollUrlFor(ownedArticle.id.value, 1)
			: undefined;

		return {
			kind: "ready",
			article: ownedArticle,
			state,
			audioEnabled,
			related,
			relatedPollUrl,
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

		const { article: ownedArticle, state, audioEnabled, related, relatedPollUrl } = resolved;

		if (isIosPlatform(req)) {
			const cspNonce = requireCspNonce(req);
			const readerBody = ReaderPage({ ...ownedArticle, content: state.content }, {
				appOrigin: deps.appOrigin,
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				capturePollUrl: state.capturePollUrl,
				progress: state.progress,
				audioEnabled,
				related,
				relatedPollUrl,
				currentPath: req.originalUrl,
				now: deps.now(),
				extensionInstallUrl: undefined,
				backLink: APP_BACK_LINK,
				renderActions: deps.chromelessReader,
			});
			assert(readerBody.scripts, "the reader page always sets its scripts");
			sendComponent(
				req, res,
				ChromelessPage(
					{
						...readerBody,
						scripts:
							readerBody.scripts +
							readerMarkReadBridgeScript(cspNonce) +
							readerCaptureBridgeScript(cspNonce),
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
					},
				),
			);
			return;
		}

		const showExtensionSuggestionBanner = !isFullyParsed({
			crawlStatus: state.crawl?.status,
			summaryStatus: state.summary?.status,
		});

		// Owner-only removal controls: which snapshots this owner authored, so the
		// bookmark can offer to delete their versions. Only the full-shell owner
		// reader below gets it — never the public /view or the iOS chromeless
		// branch above.
		const authoredVersions = await deps.findArticleCrawlVersions(ownedArticle.url);
		const authoredMinuteIds = authoredVersions
			.filter((version) => version.authorUserId === ownedArticle.userId)
			.map((version) => version.crawledAtMinute);
		const crawlBookmarkRemoval = {
			authoredMinuteIds,
			removeVersionUrl: `${QUEUE_PATH}/${ownedArticle.id.value}/remove-my-version`,
		};

		sendComponent(
			req, res,
			Base(ReaderPage({ ...ownedArticle, content: state.content }, {
				appOrigin: deps.appOrigin,
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				capturePollUrl: state.capturePollUrl,
				progress: state.progress,
				audioEnabled,
				related,
				relatedPollUrl,
				currentPath: req.originalUrl,
				now: deps.now(),
				extensionInstallUrl: extensionInstallUrlIfMissing(req),
				backLink: VIEW_BACK_LINK,
				renderActions: deps.stickyReader,
				crawlVersions: state.crawlVersions,
				crawlBookmarkRemoval,
				exitMarkReadConfirm: true,
			}), {
				...(await deps.buildBannerState(req)),
				showExtensionSuggestionBanner,
				extensionInstalled: isExtensionInstalled(req),
			}),
		);
	});

	router.use(deps.dualAuth);
	router.use(deps.resolveVerificationStatus);

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
		const platform = detectPlatform(req);
		const hasClient = hasInstallableClient(req);
		const { installed, savedArticle } = platform === "iphone"
			? await deps.getIosAppSignals({ userId })
			: { installed: isExtensionInstalled(req), savedArticle: isExtensionSavedArticle(req) };
		const dismissTokenMatches = req.cookies?.[DISMISS_COOKIE_NAME] === dismissTokenFor(hasClient);
		const onboardingDismissed = hasClient ? installed && dismissTokenMatches : dismissTokenMatches;
		return { platform, installed, savedArticle, hasInstallableClient: hasClient, onboardingDismissed };
	};

	const enabledTabLinks = (req: Request) =>
		deps.tabs.filter((tab) => tab.isEnabled(req)).map((tab) => tab.filterTab());

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		/* The iOS app loads the queue over Siren on launch; record that authed
		 * request as the "app installed + signed in" signal so step 1 ticks before
		 * any save. Header-gated, so Safari (no header) only ever reads, never writes.
		 * Best-effort: the app's main screen loads over this request, so the signal
		 * write must never be able to fail it. */
		if (isIosClient(req)) {
			await recordIosSignalBestEffort(() => deps.recordIosAnyActivity({ userId }));
		}
		if (!wantsSiren(req)) {
			const featureTab = activeQueueTab(deps.tabs, req);
			if (featureTab) {
				await featureTab.renderPage(req, res);
				return;
			}
		}
		const urlState = parseQueueUrl(req.query);
		const tab = tabQuery(urlState.tab);
		const filterUrl = typeof req.query.url === "string" ? req.query.url : undefined;

		const order = urlState.order ?? tab.defaultOrder;
		const siren = wantsSiren(req);
		const result = await deps.findArticlesByUser({
			userId,
			status: tab.status,
			sort: tab.sort,
			order,
			page: urlState.page,
			pageSize: queuePageSizeForClient(req.oauthClientId),
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
						iosSurface: isIosPlatform(req),
						iosClient: isIosClient(req) && !hasBackgroundSaveContinuity(req),
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
			const pageRedirect = canonicalQueuePageRedirect({
				state: urlState,
				total: await deps.countArticlesByUser({ userId, status: tab.status }),
				pageSize: result.pageSize,
				extraParams: [...collectUtmParams(req.query), ...collectStatusFlashParams(req.query)],
			});
			if (pageRedirect) {
				res.redirect(302, pageRedirect);
				return;
			}
		}

		const saveError = deps.httpErrorMessageMapping(req.query);
		const importFlash = importFlashMapping(req.query);
		const statusFlash = statusFlashMapping(req.query);
		const importSkipped = readImportSkippedFlash(req, res);
		const [summaryByUrl, crawlByUrl, effectiveAccess] = await Promise.all([
			loadSummaries(deps.findGeneratedSummaries, result.articles, deps.logError),
			loadCrawls(deps.findArticleCrawlStatuses, result.articles, deps.logError),
			deps.getEffectiveAccess(userId),
		]);
		const vm = toQueueViewModel(result, urlState, {
			errors: saveError ? [{ message: saveError }] : undefined,
			importFlash,
			statusFlash,
			importSkipped,
			summaryByUrl,
			crawlByUrl,
			effectiveAccess,
			now: deps.now(),
		});
		const onboarding = await resolveOnboardingSignals(req, userId);
		sendComponent(
			req, res,
			Base(
				QueuePage(vm, { ...onboarding, cspNonce: requireCspNonce(req), saveUrl: filterUrl, deviceClass: classifyDeviceClass(req.get("user-agent")), extraTabs: enabledTabLinks(req) }),
				await deps.buildBannerState(req, { preFetchedAccess: effectiveAccess }),
			),
		);
	});

	router.get("/counts", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const featureTab = activeQueueTab(deps.tabs, req);
		if (featureTab) {
			await featureTab.renderCounts(req, res);
			return;
		}
		const urlState = parseQueueUrl(req.query);
		const tab = tabQuery(urlState.tab);
		const tabTotalPromise = deps.countArticlesByUser({ userId, status: tab.status });
		const unreadCountPromise =
			tab.status === "unread"
				? tabTotalPromise
				: deps.countArticlesByUser({
						userId,
						status: "unread",
						countLimit: UNREAD_BADGE_COUNT_LIMIT,
					});
		const [tabTotal, unreadCount] = await Promise.all([
			tabTotalPromise,
			unreadCountPromise,
		]);
		res.type("html").send(
			renderQueueCounts(
				toQueueCountsDisplayModel({
					filters: urlState,
					unreadCount,
					tabTotal,
					pageSize: QUEUE_PAGE_SIZE,
				}),
			),
		);
	});

	for (const tab of deps.tabs) {
		tab.registerRoutes(router);
	}

	router.post("/dismiss-onboarding", (req: Request, res: Response) => {
		const version = dismissTokenFor(hasInstallableClient(req));
		res.cookie(DISMISS_COOKIE_NAME, version, { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true });
		res.redirect(303, QUEUE_PATH);
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
				pageSize: queuePageSizeForClient(req.oauthClientId),
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
						warning: { code: validation.error.code, message: validation.error.message },
						iosSurface: isIosPlatform(req),
						crawlByUrl,
					},
				),
			);
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const result = await saveArticleFromUrl({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
			});
			await recordSaveSignal(req, res, userId);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
			res.status(201).type(SIREN_MEDIA_TYPE).json(toSavedArticleEntity(result.saved));
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
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsed = saveArticlesUpload.parseAllParts(req);
		if (!parsed.ok) {
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
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "invalid-save-articles", message: "Invalid save-articles manifest" }),
			);
			return;
		}

		if (manifest.data.length > MAX_PAGES_PER_BULK_SAVE) {
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-articles-too-many-pages", message: `Too many tabs to save in one request (max ${MAX_PAGES_PER_BULK_SAVE})` }),
			);
			return;
		}

		type PageJob =
			| { kind: "content"; url: SaveableUrl; title?: string; mediaType: string; bytes: Buffer }
			| { kind: "url-only"; url: SaveableUrl; title?: string };
		const jobs: PageJob[] = [];
		const skipped: { url: string; code: string }[] = [];

		manifest.data.forEach((entry, index) => {
			const validation = deps.validateSaveableUrl(entry.url);
			if (validation.status !== "SUCCESS") {
				skipped.push({ url: entry.url, code: validation.error.code });
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
				jobs.push({ kind: "content", url, title: entry.title, mediaType, bytes: contentPart.content });
			} else {
				jobs.push({ kind: "url-only", url, title: entry.title });
			}
		});

		const saveOnePage = async (job: PageJob): Promise<"saved" | "failed"> => {
			try {
				const freshness = await deps.refreshArticleIfStale({ url: job.url });
				if (job.kind === "content") {
					/** Stage the captured bytes when the media type is supported; an
					 * unsupported type stages nothing and the page is saved URL-only,
					 * so the crawl enriches it the ordinary way. */
					const media = saveContentMedia[normalizeMediaType(job.mediaType)];
					if (media) await media.stageInlineBytes({ url: job.url, bytes: job.bytes, title: job.title, userId });
				}
				await saveArticleFromUrl({
					userId,
					url: job.url,
					freshness,
					provenance: resolveSaveProvenance(req.oauthClientId),
				});
				emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				return "saved";
			} catch (error) {
				deps.logError(`Failed to bulk-save url=${job.url}`, error instanceof Error ? error : undefined);
				emitSaveIntent({ req, url: job.url, path: SAVE_INTENT_PATH.saveArticles, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
				return "failed";
			}
		};

		const outcomes = await Promise.all(jobs.map(saveOnePage));
		const saved = outcomes.filter((o) => o === "saved").length;
		const failed = outcomes.filter((o) => o === "failed").length;

		if (saved > 0) markExtensionSavedArticle(res);
		res.status(200).type(SIREN_MEDIA_TYPE).json(
			toBulkSaveResultEntity({
				saved,
				skipped: skipped.length,
				failed,
				tooBig: [],
				skippedUrls: skipped,
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
				href: QUEUE_PATH,
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
				const result = await saveArticleFromUrl({
					userId,
					url: articleUrl,
					freshness,
					provenance: resolveSaveProvenance(req.oauthClientId),
				});
				await recordSaveSignal(req, res, userId);
				emitSaveIntent({ req, url: articleUrl, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				res.status(201).type(SIREN_MEDIA_TYPE).json(toSavedArticleEntity(result.saved));
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
					const media = saveContentMedia[normalizeMediaType(mediaType)];
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
							completionHref: `${QUEUE_PATH}${SAVE_ROUTE.saveContent}`,
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
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateSaveableUrl(submittedUrl);

		if (validation.status === "ERROR") {
			emitSaveIntent({ req, url: submittedUrl, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.queueSaveBar, outcome: SAVE_OUTCOMES.error });
			const urlState = parseQueueUrl({});
			const result = await deps.findArticlesByUser({ userId, excludeContent: true });
			const [summaryByUrl, crawlByUrl] = await Promise.all([
				loadSummaries(deps.findGeneratedSummaries, result.articles, deps.logError),
				loadCrawls(deps.findArticleCrawlStatuses, result.articles, deps.logError),
			]);
			const vm = toQueueViewModel(result, urlState, {
				errors: [{ message: validation.error.message }],
				saveErrorCode: validation.error.code,
				summaryByUrl,
				crawlByUrl,
			});
			const onboarding = await resolveOnboardingSignals(req, userId);
			sendComponent(req, res, Base(QueuePage(vm, { ...onboarding, cspNonce: requireCspNonce(req), statusCode: 422, deviceClass: classifyDeviceClass(req.get("user-agent")), extraTabs: enabledTabLinks(req) }), await deps.buildBannerState(req)));
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			await saveArticleFromUrl({
				userId,
				url: validation.url,
				freshness,
				provenance: resolveSaveProvenance(req.oauthClientId),
			});
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.queueSaveBar, outcome: SAVE_OUTCOMES.saved });
			res.redirect(303, `${QUEUE_PATH}#latest-saved`);
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.save, surface: SAVE_SURFACES.queueSaveBar, outcome: SAVE_OUTCOMES.error });
			res.redirect(303, `${QUEUE_PATH}?error_code=save_failed`);
		}
	});

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
		const component = await reader.handleSummaryPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderForId(article.id.value),
			capturing: parseCapturingFlag(req.query.capturing),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${QUEUE_PATH}/${article.id.value}/summary-toggle`,
			provenance: article.provenance,
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
		const component = await reader.handleReaderPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderForId(article.id.value),
			capturing: parseCapturingFlag(req.query.capturing),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${QUEUE_PATH}/${article.id.value}/summary-toggle`,
			provenance: article.provenance,
		});
		sendComponent(req, res, CacheableComponent(component, req));
	});

	router.get("/:id/related", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		if (!deps.featureToggle.isEnabled(req, RELATED_FEATURE)) {
			res.status(404).type("html").send("");
			return;
		}

		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(404).type("html").send("");
			return;
		}

		const returnTo = `${QUEUE_PATH}/${article.id.value}/view?feature=${RELATED_FEATURE}`;

		if (article.relatedDismissedAt !== undefined) {
			sendComponent(
				req, res,
				CacheableComponent(HtmlPage(renderNextRead({ returnTo })), req),
			);
			return;
		}

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
			await deps.markRelatedDismissed({
				userId,
				url: article.url,
				at: deps.now(),
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
		deps.analytics.info({
			stream: STREAMS.analytics,
			event: ANALYTICS_EVENTS.summaryToggled,
			timestamp: deps.now().toISOString(),
			user_id: userId,
			state: parsedState.data,
			visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
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

		const etag = computeQueueCardEtag({ article, crawl, summary });
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

		const filters = parseQueueUrl(req.query);
		const queueUrl = buildQueueUrl(filters);
		const queryIndex = queueUrl.indexOf("?");
		const returnQuery = queryIndex !== -1 ? queueUrl.slice(queryIndex) : "";
		const requestedPoll = parsePollParam(req.query.poll, MAX_POLLS);
		const articleVm = toQueueArticleViewModel({
			article,
			now: deps.now(),
			returnQuery,
			summary,
			crawl,
			filters,
			pollCount: requestedPoll + 1,
			maxPolls: MAX_POLLS,
		});
		const html = renderQueueCard(
			toQueueCardDisplayModel(articleVm, {
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

		const flashParams: [string, string][] = [];
		if (parsedId.success && parsedStatus.success) {
			const updated = await deps.updateArticleStatus(parsedId.data, userId, parsedStatus.data);
			if (updated) {
				flashParams.push(["status_changed", parsedStatus.data]);
				flashParams.push(["status_article", req.params.id]);
			}
			if (updated && parsedStatus.data === "read") {
				deps.analytics.info({
					stream: STREAMS.analytics,
					event: ANALYTICS_EVENTS.articleRead,
					timestamp: deps.now().toISOString(),
					user_id: userId,
					visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
					device_class: classifyDeviceClass(req.get("user-agent")),
				});
			}
		}

		res.redirect(303, buildQueueUrl(parseQueueUrl(req.query), [...collectUtmParams(req.query), ...flashParams]));
	});

	router.post("/:id/delete", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);

		if (parsedId.success) {
			await deleteArticleFromQueue({ articleId: parsedId.data, userId });
		}

		res.redirect(303, buildQueueUrl(parseQueueUrl(req.query)));
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
			res.redirect(303, `${QUEUE_PATH}/${article.id.value}/view`);
			return;
		}

		res.redirect(303, `${QUEUE_PATH}/${req.params.id}/view`);
	});

	return router;
}
