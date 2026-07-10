import assert from "node:assert";
import {
	DISMISS_COOKIE_NAME,
	EXTENSION_LIVENESS_TTL_MS,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { ErrorRequestHandler, Request, RequestHandler, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { SaveableUrl, ValidateSaveableUrl } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";
import { SaveArticleInputSchema, BulkSaveManifestSchema, MAX_PAGES_PER_BULK_SAVE, MAX_PAGE_CONTENT_BYTES, MAX_BULK_CONTENT_REQUEST_BYTES, SaveHtmlInputSchema, ArticleStatusSchema, MAX_RAW_HTML_REQUEST_BYTES, RAW_HTML_FIELD, saveableUrlErrorMessage } from "@packages/domain/article";
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
	MarkSummaryToggled,
	SaveArticle,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";
import type { PutPendingPdf } from "@packages/provider-contracts/pending-pdf";
import { MAX_PDF_BYTES, isPDF } from "@packages/crawl-article";
import { initMultipartUpload } from "../import/multipart-upload";
import { initSaveContentLimitHandler } from "./save-content-limit-handler";
import { initSaveArticlesLimitHandler } from "./save-articles-limit-handler";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type { RenderReaderActions } from "../../shared/article-body/reader-actions/reader-actions.component";
import type { PollUrlBuilder } from "../../shared/article-reader/article-reader.types";
import type { PublishLinkSaved } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import { initSaveArticleFromUrl } from "../../shared/save-article/save-article-from-url";
import { Base, ChromelessPage } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "@packages/web-shell";
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
import { toArticleEntity } from "../../api/article-siren";
import { parseQueueUrl, buildQueueUrl, QUEUE_PATH, canonicalQueuePageRedirect } from "./queue.url";
import { collectUtmParams } from "../../shared/utm";
import { tabQuery } from "./queue.tabs";
import type { HttpErrorMessageMapping } from "./queue.error";
import { collectStatusFlashParams, importFlashMapping, statusFlashMapping } from "./queue.error";
import { MAX_POLLS } from "@packages/web-shell";
import { parsePollParam } from "@packages/web-shell";
import { toQueueArticleViewModel, toQueueViewModel } from "./queue.viewmodel";
import { QueuePage } from "./queue.component";
import {
	renderQueueCard,
	toQueueCardDisplayModel,
} from "./queue-card/queue-card.component";
import { computeQueueCardEtag } from "./queue-card/queue-card.etag";
import { etagMatches } from "@packages/web-shell";
import { ReaderPage, formatReaderDocumentTitle } from "../reader/reader.component";
import { NO_CLIENT_ONBOARDING_VERSION, ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import {
	detectPlatform,
	extensionInstallUrlIfMissing,
	hasInstallableClient,
	isExtensionInstalled,
	isExtensionSavedArticle,
} from "../../onboarding/extension-install";
import { isIosClient, isIosSurface } from "../../onboarding/ios-client";
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

type SaveContentMediaHandler = (input: {
	url: string;
	bytes: Buffer;
	title?: string;
	userId: UserId;
}) => Promise<SaveContentResult>;

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
	publishLinkSaved: PublishLinkSaved;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	publishSaveLinkRawPdfCommand: PublishSaveLinkRawPdfCommand;
	putPendingHtml: PutPendingHtml;
	putPendingPdf: PutPendingPdf;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	refreshArticleIfStale: RefreshArticleIfStale;
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
	logError: (message: string, error?: Error) => void;
	logParseError: LogParseError;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
	now: () => Date;
	featureToggle: QuerystringFeatureToggle;
}

import type { SavedArticle } from "@packages/domain/article";

async function loadSummaries(
	findGeneratedSummary: FindGeneratedSummary,
	articles: readonly SavedArticle[],
): Promise<Map<string, GeneratedSummary | undefined>> {
	const results = await Promise.allSettled(articles.map((a) => findGeneratedSummary(a.url)));
	return new Map(articles.map((a, i) => {
		const r = results[i];
		return [a.url, r.status === "fulfilled" ? r.value : undefined] as const;
	}));
}

async function loadCrawls(
	findArticleCrawlStatus: FindArticleCrawlStatus,
	articles: readonly SavedArticle[],
): Promise<Map<string, ArticleCrawl | undefined>> {
	const results = await Promise.allSettled(articles.map((a) => findArticleCrawlStatus(a.url)));
	return new Map(articles.map((a, i) => {
		const r = results[i];
		return [a.url, r.status === "fulfilled" ? r.value : undefined] as const;
	}));
}

const SAVE_ROUTE = {
	saveArticle: "/",
	saveArticles: "/save-articles",
	save: "/save",
	saveHtml: "/save-html",
	saveContent: "/save-content",
} as const;

/** Root ("/") maps to QUEUE_PATH alone; appending it would record a spurious "/queue/" trailing slash. */
const saveIntentPath = (route: string): string =>
	route === "/" ? QUEUE_PATH : `${QUEUE_PATH}${route}`;

const SAVE_INTENT_PATH = {
	saveArticle: saveIntentPath(SAVE_ROUTE.saveArticle),
	saveArticles: saveIntentPath(SAVE_ROUTE.saveArticles),
	save: saveIntentPath(SAVE_ROUTE.save),
	saveHtml: saveIntentPath(SAVE_ROUTE.saveHtml),
	saveContent: saveIntentPath(SAVE_ROUTE.saveContent),
} as const;

const VIEW_BACK_LINK = {
	topHref: "/queue?utm_source=reader&utm_medium=internal&utm_content=back-top",
	label: "← Back to queue",
} as const;

/** Deep link the iOS WKWebView delegate intercepts (and cancels) to close the
 * reader sheet, returning the user to the native reading list. The chromeless
 * reader's "← Back to queue" points here. */
const READER_CLOSE_HREF = "readplace://reader/close";
const APP_BACK_LINK = {
	topHref: READER_CLOSE_HREF,
	label: "← Back to queue",
} as const;

/** Server-authored bridge for the iOS in-app reader: when the reader's mark-read
 * htmx request completes, tell the WKWebView so the native app closes the sheet
 * and reconciles its list. Guarded on the WKWebView message handler, so it is inert
 * in a normal browser that renders this same reader. Keeping the htmx detail here —
 * rather than injected by the app — keeps the htmx coupling on the server that owns
 * htmx; the app only registers the `readplaceReader` handler and reacts to the
 * `markedRead` message, with no knowledge of the front-end's event shape. */
const READER_MARK_READ_BRIDGE_SCRIPT = `<script>
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

/** True when the client wants the app's chromeless reader rather than the full web
 * shell — chosen by an explicit client signal, never a user-agent sniff. The app
 * appends `?platform=ios` to the `read` link it loads in its WKWebView; the
 * `x-readplace-client` header is honoured alongside it so a store-reviewed build
 * predating the query param — which cannot deploy in lockstep with the server —
 * still resolves to its chromeless reader. */
const isIosPlatform = (req: Request): boolean => isIosSurface(req);

export function initQueueRoutes(deps: QueueDependencies): Router {
	const router = express.Router();
	const saveArticleFromUrl = initSaveArticleFromUrl(deps);

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

	/** Stages captured bytes (HTML or PDF) into the pending store and dispatches
	 * the matching save-link command, keyed by normalised media type. Shared by
	 * the single-page save-content route and the bulk save-articles route. */
	const saveContentHandlers: Record<string, SaveContentMediaHandler> = {
		"application/pdf": async ({ url, bytes, userId }) => {
			if (!isPDF({ bodyBytes: bytes })) {
				return { ok: false, code: "not-a-pdf", message: "Uploaded bytes do not look like a PDF (missing %PDF- magic header)" };
			}
			await deps.putPendingPdf({ url, bytes });
			await deps.publishSaveLinkRawPdfCommand({ url, userId });
			return { ok: true };
		},
		"text/html": async ({ url, bytes, title, userId }) => {
			const html = bytes.toString("utf8");
			await deps.putPendingHtml({ url, html });
			await deps.publishSaveLinkRawHtmlCommand({ url, userId, title });
			return { ok: true };
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
	});

	function pollUrlBuilderForId(articleId: string): PollUrlBuilder {
		return {
			summary: (n) => `${QUEUE_PATH}/${articleId}/summary?poll=${n}`,
			reader: (n) => `${QUEUE_PATH}/${articleId}/reader?poll=${n}`,
		};
	}

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
	router.get("/:id/read", (req: Request, res: Response) => {
		const queryIndex = req.originalUrl.indexOf("?");
		const queryString = queryIndex !== -1 ? req.originalUrl.slice(queryIndex) : "";
		res.redirect(301, `${QUEUE_PATH}/${req.params.id}/view${queryString}`);
	});

	type ResolvedReaderState = Awaited<ReturnType<typeof reader.resolveReaderState>>;
	type OwnerReaderResolution =
		| { kind: "redirect"; redirect: Redirect }
		| { kind: "ready"; article: SavedArticle; state: ResolvedReaderState; audioEnabled: boolean };

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

		const ownedArticle = result.article;

		await deps.markArticleViewed({
			userId: ownedArticle.userId,
			url: ownedArticle.url,
			at: deps.now(),
		});

		const audioEnabled = deps.featureToggle.isEnabled(req, "audio");
		const state = await reader.resolveReaderState({
			article: {
				url: ownedArticle.url,
				metadata: ownedArticle.metadata,
				estimatedReadTime: ownedArticle.estimatedReadTime,
			},
			pollUrlBuilder: pollUrlBuilderForId(ownedArticle.id.value),
		});

		return { kind: "ready", article: ownedArticle, state, audioEnabled };
	};

	router.get("/:id/view", async (req: Request<{ id: string }>, res: Response) => {
		const resolved = await resolveOwnerReader(req);
		if (resolved.kind === "redirect") {
			sendComponent(req, res, RedirectComponent(resolved.redirect));
			return;
		}

		const { article: ownedArticle, state, audioEnabled } = resolved;

		if (isIosPlatform(req)) {
			const readerBody = ReaderPage({ ...ownedArticle, content: state.content }, {
				appOrigin: deps.appOrigin,
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				progress: state.progress,
				audioEnabled,
				extensionInstallUrl: undefined,
				backLink: APP_BACK_LINK,
				renderActions: deps.chromelessReader,
			});
			assert(readerBody.scripts, "the reader page always sets its scripts");
			sendComponent(
				req, res,
				ChromelessPage({
					...readerBody,
					scripts: readerBody.scripts + READER_MARK_READ_BRIDGE_SCRIPT,
				}),
			);
			return;
		}

		const showExtensionSuggestionBanner = !isFullyParsed({
			crawlStatus: state.crawl?.status,
			summaryStatus: state.summary?.status,
		});

		sendComponent(
			req, res,
			Base(ReaderPage({ ...ownedArticle, content: state.content }, {
				appOrigin: deps.appOrigin,
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				progress: state.progress,
				audioEnabled,
				extensionInstallUrl: extensionInstallUrlIfMissing(req),
				backLink: VIEW_BACK_LINK,
				renderActions: deps.stickyReader,
				crawlVersions: state.crawlVersions,
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
		const urlState = parseQueueUrl(req.query);
		const tab = tabQuery(urlState.tab);
		const filterUrl = typeof req.query.url === "string" ? req.query.url : undefined;

		const order = urlState.order ?? tab.defaultOrder;
		const result = await deps.findArticlesByUser({
			userId,
			status: tab.status,
			sort: tab.sort,
			order,
			page: urlState.page,
		});

		if (wantsSiren(req)) {
			const filteredArticles = filterUrl
				? result.articles.filter(a => a.url === filterUrl)
				: result.articles;
			const filtered = filterUrl
				? { ...result, articles: filteredArticles, total: filteredArticles.length }
				: result;

			res.type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					filtered,
					{
						status: tab.status,
						order: urlState.order,
						page: urlState.page,
						pageSize: result.pageSize,
						url: filterUrl,
					},
					{ iosSurface: isIosPlatform(req) },
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
		const pageRedirect = canonicalQueuePageRedirect({
			state: urlState,
			total: result.total,
			pageSize: result.pageSize,
			extraParams: [...collectUtmParams(req.query), ...collectStatusFlashParams(req.query)],
		});
		if (pageRedirect) {
			res.redirect(302, pageRedirect);
			return;
		}

		const saveError = deps.httpErrorMessageMapping(req.query);
		const importFlash = importFlashMapping(req.query);
		const statusFlash = statusFlashMapping(req.query);
		const importSkipped = readImportSkippedFlash(req, res);
		const [summaryByUrl, crawlByUrl, unreadCount, effectiveAccess] = await Promise.all([
			loadSummaries(deps.findGeneratedSummary, result.articles),
			loadCrawls(deps.findArticleCrawlStatus, result.articles),
			urlState.tab === "queue"
				? Promise.resolve(result.total)
				: deps.countArticlesByUser({ userId, status: "unread" }),
			deps.getEffectiveAccess(userId),
		]);
		const vm = toQueueViewModel(result, urlState, {
			unreadCount,
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
				QueuePage(vm, { ...onboarding, saveUrl: filterUrl, deviceClass: classifyDeviceClass(req.get("user-agent")) }),
				await deps.buildBannerState(req, { preFetchedAccess: effectiveAccess }),
			),
		);
	});

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
			const collection = await deps.findArticlesByUser({ userId });
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(
					collection,
					{ page: collection.page, pageSize: collection.pageSize },
					{
						warning: { code: validation.error.code, message: validation.error.message },
						iosSurface: isIosPlatform(req),
					},
				),
			);
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const result = await saveArticleFromUrl({ userId, url: validation.url, freshness });
			await recordSaveSignal(req, res, userId);
			emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveArticle, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
			res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
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
	 *   - captured content within MAX_PAGE_CONTENT_BYTES → staged via the shared
	 *     save-content handlers, then stub-saved so the crawl enriches it;
	 *   - captured content over the per-page cap → reported in `tooBig` and saved
	 *     URL-only, the same degrade-to-URL-only path save-content takes for an
	 *     oversize upload, so the link is kept;
	 *   - no captured content (unscriptable or discarded tab) → saved URL-only.
	 * The window is chunked client-side to MAX_PAGES_PER_BULK_SAVE; a request over
	 * that count is rejected early, and saveArticlesLimitHandler turns a body over
	 * the sized parser limit into a Siren 422 rather than an unhandled 413. */
	const saveArticlesUpload = initMultipartUpload({ maxBytes: MAX_BULK_CONTENT_REQUEST_BYTES });
	const saveArticlesLimitHandler = initSaveArticlesLimitHandler({
		logError: deps.logError,
		maxBytes: MAX_BULK_CONTENT_REQUEST_BYTES,
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
		const tooBig: { url: string; mb: number }[] = [];

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
				if (contentPart.content.length > MAX_PAGE_CONTENT_BYTES) {
					tooBig.push({ url, mb: bytesToMb(contentPart.content.length) });
					jobs.push({ kind: "url-only", url, title: entry.title });
				} else {
					jobs.push({ kind: "content", url, title: entry.title, mediaType, bytes: contentPart.content });
				}
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
					const handler = saveContentHandlers[normalizeMediaType(job.mediaType)];
					if (handler) await handler({ url: job.url, bytes: job.bytes, title: job.title, userId });
				}
				await saveArticleFromUrl({ userId, url: job.url, freshness });
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
				tooBig,
				skippedUrls: skipped,
			}),
		);
	});

	/** Translates body-parser oversize errors (bodies above MAX_RAW_HTML_REQUEST_BYTES, where we can't reach req.body.url to salvage) into a Siren 500 carrying the save-article action, so the extension can drop the oversized rawHtml and degrade onto the URL-only tier. Also gated on err.limit as defense-in-depth against a future middleware in the chain raising entity.too.large for a different parser. */
	const saveHtmlLimitHandler: ErrorRequestHandler = (err, req, res, next) => {
		const bodyErr = err as { type?: string; limit?: number } | null;
		if (
			bodyErr?.type === "entity.too.large" &&
			bodyErr.limit === MAX_RAW_HTML_REQUEST_BYTES &&
			wantsSiren(req)
		) {
			const mb = MAX_RAW_HTML_REQUEST_BYTES / (1024 * 1024);
			deps.logError(
				`request body exceeded ${mb}MB`,
				err instanceof Error ? err : undefined,
			);
			// url=null because body-parser rejected before req.body was populated.
			deps.logParseError({ url: null, reason: "payload-too-large" });
			res.status(500).type(SIREN_MEDIA_TYPE).json(
				sirenError({
					code: "html-too-large",
					message: `Submitting the HTML of this page has failed due to being too large exceeding ${mb}MB`,
					actions: [
						{
							name: "save-article",
							title: "Save a link",
							href: QUEUE_PATH,
							method: "POST",
							type: "application/json",
							fields: [{ name: "url", type: "url" }],
						},
					],
				}),
			);
			return;
		}
		next(err);
	};

	router.post(SAVE_ROUTE.saveHtml, requireNotLocked, deps.requireWriteAccess, express.json({ limit: MAX_RAW_HTML_REQUEST_BYTES }), saveHtmlLimitHandler, async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		let validatedArticleUrl: string | undefined;

		try {
			const parsed = SaveHtmlInputSchema.safeParse(req.body);

			if (!parsed.success) {
				/* rawHtml-too-big is the one schema failure the user can still recover
				 * from: the URL is valid, the content is just too bulky to capture via
				 * Tier 0. Fall back to a URL-only save so Tier 1 crawls the page the
				 * ordinary way. Any other schema failure (missing/bad url, empty
				 * rawHtml) is a client bug and stays a 422. */
				const rawHtmlTooBig = parsed.error.issues.some(
					(i) => i.code === "too_big" && i.path[i.path.length - 1] === RAW_HTML_FIELD,
				);
				const urlOnly = rawHtmlTooBig ? SaveArticleInputSchema.safeParse(req.body) : undefined;
				const urlOnlyValidation = urlOnly?.success
					? deps.validateSaveableUrl(urlOnly.data.url)
					: undefined;
				if (urlOnlyValidation?.status === "SUCCESS") {
					validatedArticleUrl = urlOnlyValidation.url;
					const rawHtml: unknown = req.body?.rawHtml;
					const sizeBytes = typeof rawHtml === "string" ? rawHtml.length : 0;
					/* logError (not warn) on purpose: feeds the alarm so oversize Tier-0
					 * captures stay visible — they're the signal for raising MAX_RAW_HTML_BYTES. */
					deps.logError(
						`[SaveHtmlOversize] falling back to URL-only url=${urlOnlyValidation.url} userId=${userId} sizeBytes=${sizeBytes}`,
					);
					const freshness = await deps.refreshArticleIfStale({ url: urlOnlyValidation.url });
					const result = await saveArticleFromUrl({ userId, url: urlOnlyValidation.url, freshness });
					await recordSaveSignal(req, res, userId);
					emitSaveIntent({ req, url: urlOnlyValidation.url, path: SAVE_INTENT_PATH.saveHtml, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
					res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
					return;
				}
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "invalid-save-html", message: "Invalid save-html request" }),
				);
				return;
			}

			const urlValidation = deps.validateSaveableUrl(parsed.data.url);
			if (urlValidation.status === "ERROR") {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "invalid-save-html", message: urlValidation.error.message }),
				);
				return;
			}
			const articleUrl = urlValidation.url;
			validatedArticleUrl = articleUrl;

			const freshness = await deps.refreshArticleIfStale({ url: articleUrl });

			await deps.putPendingHtml({ url: articleUrl, html: parsed.data.rawHtml });
			await deps.publishSaveLinkRawHtmlCommand({
				url: articleUrl,
				userId,
				title: parsed.data.title,
			});

			const result = await saveArticleFromUrl({ userId, url: articleUrl, freshness });
			await recordSaveSignal(req, res, userId);
			emitSaveIntent({ req, url: articleUrl, path: SAVE_INTENT_PATH.saveHtml, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
			res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
		} catch (error) {
			deps.logError("Failed to save article from html", error instanceof Error ? error : undefined);
			assert(validatedArticleUrl, "save-html reaches the save pipeline only after the article URL is validated");
			emitSaveIntent({ req, url: validatedArticleUrl, path: SAVE_INTENT_PATH.saveHtml, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
			res.status(500).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-failed", message: "Could not save article" }),
			);
		}
	});

	/** Unified content entry point. The extension sends captured bytes (HTML or
	 * PDF) together with a `mediaType` hint; the server validates and dispatches
	 * to the existing HTML or PDF pipeline. */
	const contentUpload = initMultipartUpload({ maxBytes: MAX_PDF_BYTES.bytes });
	const saveContentLimitHandler = initSaveContentLimitHandler({
		logError: deps.logError,
		maxBytes: MAX_PDF_BYTES.bytes,
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

			const urlPart = parsed.parts.find((p) => p.name === "url" && !p.isFile);
			const contentPart = parsed.parts.find((p) => p.name === "content" && p.isFile);
			const mediaTypePart = parsed.parts.find((p) => p.name === "mediaType" && !p.isFile);
			const titlePart = parsed.parts.find((p) => p.name === "title" && !p.isFile);

			const submittedUrl = urlPart ? urlPart.content.toString("utf8") : "";
			const mediaType = mediaTypePart ? mediaTypePart.content.toString("utf8") : "";
			const contentBytes = contentPart?.content;
			const title = titlePart ? titlePart.content.toString("utf8") : undefined;

			if (!contentBytes || contentBytes.length === 0) {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({
						code: "invalid-save-content",
						message: "save-content requires a content field with data",
						actions: [buildFallbackAction()],
					}),
				);
				return;
			}

			if (!mediaType) {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({
						code: "invalid-save-content",
						message: "save-content requires a mediaType field",
						actions: [buildFallbackAction()],
					}),
				);
				return;
			}

			const validation = deps.validateSaveableUrl(submittedUrl);
			if (validation.status === "ERROR") {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({
						code: "invalid-save-content",
						message: validation.error.message,
						actions: [buildFallbackAction()],
					}),
				);
				return;
			}

			try {
				const articleUrl = validation.url;
				const freshness = await deps.refreshArticleIfStale({ url: articleUrl });
				const normalized = normalizeMediaType(mediaType);
				const handler = saveContentHandlers[normalized];

				if (!handler) {
					res.status(422).type(SIREN_MEDIA_TYPE).json(
						sirenError({
							code: "unsupported-media-type",
							message: `Unsupported media type: ${mediaType}`,
							actions: [buildFallbackAction()],
						}),
					);
					return;
				}

				const handlerResult = await handler({ url: articleUrl, bytes: contentBytes, title, userId });
				if (!handlerResult.ok) {
					res.status(422).type(SIREN_MEDIA_TYPE).json(
						sirenError({
							code: handlerResult.code,
							message: handlerResult.message,
							actions: [buildFallbackAction()],
						}),
					);
					return;
				}

				const result = await saveArticleFromUrl({ userId, url: articleUrl, freshness });
				await recordSaveSignal(req, res, userId);
				emitSaveIntent({ req, url: articleUrl, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.saved });
				res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
			} catch (error) {
				deps.logError("Failed to save article from content", error instanceof Error ? error : undefined);
				emitSaveIntent({ req, url: validation.url, path: SAVE_INTENT_PATH.saveContent, surface: SAVE_SURFACES.extension, outcome: SAVE_OUTCOMES.error });
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
			const urlState = parseQueueUrl({});
			const result = await deps.findArticlesByUser({ userId });
			const unreadCount = await deps.countArticlesByUser({ userId, status: "unread" });
			const [summaryByUrl, crawlByUrl] = await Promise.all([
				loadSummaries(deps.findGeneratedSummary, result.articles),
				loadCrawls(deps.findArticleCrawlStatus, result.articles),
			]);
			const vm = toQueueViewModel(result, urlState, {
				errors: [{ message: validation.error.message }],
				saveErrorCode: validation.error.code,
				unreadCount,
				summaryByUrl,
				crawlByUrl,
			});
			const onboarding = await resolveOnboardingSignals(req, userId);
			sendComponent(req, res, Base(QueuePage(vm, { ...onboarding, statusCode: 422, deviceClass: classifyDeviceClass(req.get("user-agent")) }), await deps.buildBannerState(req)));
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			await saveArticleFromUrl({ userId, url: validation.url, freshness });
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
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${QUEUE_PATH}/${article.id.value}/summary-toggle`,
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
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${QUEUE_PATH}/${article.id.value}/summary-toggle`,
		});
		sendComponent(req, res, CacheableComponent(component, req));
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
			await deps.deleteArticle(parsedId.data, userId);
		}

		res.redirect(303, buildQueueUrl(parseQueueUrl(req.query)));
	});

	return router;
}
