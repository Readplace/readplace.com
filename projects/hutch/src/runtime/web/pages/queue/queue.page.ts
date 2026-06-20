import assert from "node:assert";
import {
	DISMISS_COOKIE_NAME,
	EXTENSION_LIVENESS_TTL_MS,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { ErrorRequestHandler, Request, RequestHandler, Response, Router } from "express";
import express from "express";
import type { HutchLogger } from "@packages/hutch-logger";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import { SaveArticleInputSchema, SaveHtmlInputSchema, ArticleStatusSchema, MAX_RAW_HTML_REQUEST_BYTES, RAW_HTML_FIELD, saveableUrlErrorMessage } from "@packages/domain/article";
import { buildSaveIntentEvent, hashIp, type AnalyticsEvent } from "../../middleware/analytics";
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
	FindArticleUrlById,
	FindArticlesByUser,
	MarkArticleViewed,
	SaveArticle,
	UpdateArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawPdfCommand } from "@packages/provider-contracts/events";
import type { PutPendingPdf } from "@packages/provider-contracts/pending-pdf";
import { MAX_PDF_BYTES, isPDF } from "@packages/crawl-article";
import { initMultipartUpload } from "../import/multipart-upload";
import { initSaveContentLimitHandler } from "./save-content-limit-handler";
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
import type { PollUrlBuilder } from "../../shared/article-reader/article-reader.types";
import type { PublishLinkSaved } from "@packages/provider-contracts/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/provider-contracts/events";
import type { PutPendingHtml } from "@packages/provider-contracts/pending-html";
import { saveArticleFromUrl } from "../../shared/save-article/save-article-from-url";
import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";
import { sendComponent } from "@packages/web-shell";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { RedirectComponent } from "../../redirect.component";
import { CacheableComponent } from "../../conditional-get";
import { isFullyParsed } from "../../shared/article-state/is-fully-parsed";
import { initReaderPermalink } from "./reader-permalink";
import { wantsSiren } from "../../content-negotiation";
import type { QuerystringFeatureToggle } from "../../feature-toggle";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { toArticleEntity } from "../../api/article-siren";
import { parseQueueUrl, buildQueueUrl, QUEUE_PATH, canonicalQueuePageRedirect } from "./queue.url";
import { collectUtmParams } from "../../shared/utm";
import { tabQuery } from "./queue.tabs";
import type { HttpErrorMessageMapping } from "./queue.error";
import { collectStatusFlashParams, importFlashMapping, statusFlashMapping } from "./queue.error";
import { MAX_POLLS } from "../../shared/article-reader/article-reader";
import { toQueueArticleViewModel, toQueueViewModel } from "./queue.viewmodel";
import { QueuePage } from "./queue.component";
import {
	renderQueueCard,
	toQueueCardDisplayModel,
} from "./queue-card/queue-card.component";
import { computeQueueCardEtag, etagMatches } from "./queue-card/queue-card.etag";
import { ReaderPage, formatReaderDocumentTitle, markReadPostUrl } from "../reader/reader.component";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import {
	detectBrowser,
	extensionInstallUrlIfMissing,
	isExtensionInstalled,
	isExtensionSavedArticle,
} from "../../onboarding/extension-install";
import type { GetEffectiveAccess } from "../../../domain/access/effective-access";
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
	userId: string;
}) => Promise<SaveContentResult>;

function normalizeMediaType(mediaType: string): string {
	const base = mediaType.split(";")[0].trim().toLowerCase();
	if (isPDF({ contentType: base })) return "application/pdf";
	return base;
}

interface QueueDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	saveArticle: SaveArticle;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	markArticleViewed: MarkArticleViewed;
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
	httpErrorMessageMapping: HttpErrorMessageMapping;
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
	save: "/save",
	saveHtml: "/save-html",
	saveContent: "/save-content",
} as const;

/** Root ("/") maps to QUEUE_PATH alone; appending it would record a spurious "/queue/" trailing slash. */
const saveIntentPath = (route: string): string =>
	route === "/" ? QUEUE_PATH : `${QUEUE_PATH}${route}`;

const SAVE_INTENT_PATH = {
	saveArticle: saveIntentPath(SAVE_ROUTE.saveArticle),
	save: saveIntentPath(SAVE_ROUTE.save),
	saveHtml: saveIntentPath(SAVE_ROUTE.saveHtml),
	saveContent: saveIntentPath(SAVE_ROUTE.saveContent),
} as const;

export function initQueueRoutes(deps: QueueDependencies): Router {
	const router = express.Router();

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

	const reader = initArticleReader({
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		appOrigin: deps.appOrigin,
		formatDocumentTitle: formatReaderDocumentTitle,
		backLink: { href: QUEUE_PATH, label: "← Back to queue" },
		markReadAction: (articleId) => ({
			postUrl: markReadPostUrl(articleId, "top"),
			label: "Mark as read",
			fields: [{ name: "status", value: "read" }],
		}),
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
	 * The legacy `/queue/:id/read` URL — previously the page itself, now
	 * the explicit mutation — 301-redirects to `/queue/:id/view` so old
	 * bookmarks, share links, search-engine indexes and Siren `rel="read"`
	 * hrefs emitted by historical responses keep resolving. */
	router.get("/:id/read", (req: Request, res: Response) => {
		const queryIndex = req.originalUrl.indexOf("?");
		const queryString = queryIndex !== -1 ? req.originalUrl.slice(queryIndex) : "";
		res.redirect(301, `${QUEUE_PATH}/${req.params.id}/view${queryString}`);
	});

	router.get("/:id/view", async (req: Request<{ id: string }>, res: Response) => {
		const result = await resolveReaderPermalink({
			rawId: req.params.id,
			requesterId: req.userId,
			query: req.query,
		});

		if (result.kind === "redirect") {
			sendComponent(req, res, RedirectComponent(result.redirect));
			return;
		}

		const ownedArticle = result.article;

		/* Server-side reader-view presence: stamp every owner open so the
		 * reader-ready notifier can tell "viewed while loading, then left" from
		 * "never opened". No client JS — this request is the only signal. */
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
			}), {
				...(await deps.buildBannerState(req)),
				showExtensionSuggestionBanner,
				extensionInstalled: isExtensionInstalled(req),
			}),
		);
	});

	router.use(deps.dualAuth);
	router.use(deps.resolveVerificationStatus);

	router.get("/", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
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
				toArticleCollectionEntity(filtered, {
					status: tab.status,
					order: urlState.order,
					page: urlState.page,
					pageSize: result.pageSize,
					url: filterUrl,
				}),
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
		const extensionInstalled = isExtensionInstalled(req);
		const extensionSavedArticle = isExtensionSavedArticle(req);
		/** Dismissal only counts when the extension is also installed in *this* browser.
		 * The dismiss button only appears once every step (including install-extension)
		 * is complete, so a dismiss without the install cookie means the user is in a
		 * different browser context (or has lost the install cookie) — show the popup
		 * again so they can install the extension here. */
		const onboardingDismissed = extensionInstalled && req.cookies?.[DISMISS_COOKIE_NAME] === ONBOARDING_VERSION;
		const browser = detectBrowser(req);
		sendComponent(
			req, res,
			Base(
				QueuePage(vm, { saveUrl: filterUrl, extensionInstalled, extensionSavedArticle, browser, onboardingDismissed }),
				await deps.buildBannerState(req, { preFetchedAccess: effectiveAccess }),
			),
		);
	});

	router.post("/dismiss-onboarding", (_req: Request, res: Response) => {
		res.cookie(DISMISS_COOKIE_NAME, ONBOARDING_VERSION, { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true });
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
					{ warning: { code: validation.error.code, message: validation.error.message } },
				),
			);
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			const result = await saveArticleFromUrl(deps, { userId, url: validation.url, freshness });
			markExtensionSavedArticle(res);
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
					const result = await saveArticleFromUrl(deps, { userId, url: urlOnlyValidation.url, freshness });
					markExtensionSavedArticle(res);
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

			const result = await saveArticleFromUrl(deps, { userId, url: articleUrl, freshness });
			markExtensionSavedArticle(res);
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

				const result = await saveArticleFromUrl(deps, { userId, url: articleUrl, freshness });
				markExtensionSavedArticle(res);
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
			sendComponent(req, res, Base(QueuePage(vm, { statusCode: 422 }), await deps.buildBannerState(req)));
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			await saveArticleFromUrl(deps, { userId, url: validation.url, freshness });
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

		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleSummaryPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderForId(article.id.value),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
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

		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleReaderPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderForId(article.id.value),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
		});
		sendComponent(req, res, CacheableComponent(component, req));
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
		const requestedPoll = Number(req.query.poll ?? "0");
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
			toQueueCardDisplayModel(articleVm, { isFirst: false }),
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
