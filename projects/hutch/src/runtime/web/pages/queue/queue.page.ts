import assert from "node:assert";
import {
	DISMISS_COOKIE_NAME,
	EXTENSION_LIVENESS_TTL_MS,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { ErrorRequestHandler, Request, RequestHandler, Response, Router } from "express";
import express from "express";
import type { LogParseError } from "@packages/hutch-infra-components";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import { SaveArticleInputSchema, SaveHtmlInputSchema, ArticleStatusSchema, MAX_RAW_HTML_REQUEST_BYTES, RAW_HTML_FIELD, saveableUrlErrorMessage } from "@packages/domain/article";
import {
	IMPORT_SKIPPED_COOKIE_NAME,
	decodeImportSkippedCookie,
} from "../import/import-skipped-cookie";
import type { ImportSkippedViewModel } from "./queue.viewmodel";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type {
	DeleteArticle,
	FindArticleById,
	FindArticleByUrl,
	FindArticleUrlById,
	FindArticlesByUser,
	SaveArticle,
	UpdateArticleStatus,
} from "@packages/test-fixtures/providers/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import type { ReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import type {
	ArticleCrawl,
	FindArticleCrawlStatus,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	FindGeneratedSummary,
	GeneratedSummary,
	MarkSummaryPending,
} from "@packages/test-fixtures/providers/article-summary";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type { PollUrlBuilder } from "../../shared/article-reader/article-reader.types";
import type { PublishLinkSaved } from "@packages/test-fixtures/providers/events";
import type { PublishSaveLinkRawHtmlCommand } from "@packages/test-fixtures/providers/events";
import type { PutPendingHtml } from "@packages/test-fixtures/providers/pending-html";
import { saveArticleFromUrl, saveUnsaveableUrlStub } from "../../shared/save-article/save-article-from-url";
import { Base } from "../../base.component";
import { bannerStateFromRequest } from "../../banner-state";
import { sendComponent } from "../../send-component";
import { RedirectComponent } from "../../redirect.component";
import { CacheableComponent } from "../../conditional-get";
import { isFullyParsed } from "../../shared/article-state/is-fully-parsed";
import { initReaderPermalink } from "./reader-permalink";
import { wantsSiren } from "../../content-negotiation";
import type { QuerystringFeatureToggle } from "../../feature-toggle";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { toArticleEntity } from "../../api/article-siren";
import { parseQueueUrl, buildQueueUrl } from "./queue.url";
import { tabQuery } from "./queue.tabs";
import type { HttpErrorMessageMapping } from "./queue.error";
import { importFlashMapping } from "./queue.error";
import { MAX_CARD_POLLS, toQueueArticleViewModel, toQueueViewModel } from "./queue.viewmodel";
import { QueuePage } from "./queue.component";
import {
	renderQueueCard,
	toQueueCardDisplayModel,
} from "./queue-card/queue-card.component";
import { computeQueueCardEtag, etagMatches } from "./queue-card/queue-card.etag";
import { ReaderPage, formatReaderDocumentTitle } from "../reader/reader.component";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import {
	detectBrowser,
	extensionInstallUrlIfMissing,
	isExtensionInstalled,
	isExtensionSavedArticle,
} from "../../onboarding/extension-install";
function readImportSkippedFlash(
	req: Request,
	res: Response,
): ImportSkippedViewModel | undefined {
	const raw = req.cookies?.[IMPORT_SKIPPED_COOKIE_NAME];
	const decoded = decodeImportSkippedCookie(raw);
	if (!decoded || decoded.entries.length === 0) return undefined;
	/** Cookie is read-once: clear it so a refresh of /queue doesn't keep
	 * surfacing the "couldn't import" banner. */
	res.clearCookie(IMPORT_SKIPPED_COOKIE_NAME, { path: "/queue" });
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

interface QueueDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	findArticlesByUser: FindArticlesByUser;
	findArticleById: FindArticleById;
	findArticleByUrl: FindArticleByUrl;
	findArticleUrlById: FindArticleUrlById;
	saveArticle: SaveArticle;
	deleteArticle: DeleteArticle;
	updateArticleStatus: UpdateArticleStatus;
	publishLinkSaved: PublishLinkSaved;
	publishSaveLinkRawHtmlCommand: PublishSaveLinkRawHtmlCommand;
	putPendingHtml: PutPendingHtml;
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
	logError: (message: string, error?: Error) => void;
	logParseError: LogParseError;
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

export function initQueueRoutes(deps: QueueDependencies): Router {
	const router = express.Router();
	const reader = initArticleReader({
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		formatDocumentTitle: formatReaderDocumentTitle,
		backLink: { href: "/queue", label: "← Back to queue" },
		now: deps.now,
	});
	const resolveReaderPermalink = initReaderPermalink({
		findArticleById: deps.findArticleById,
		findArticleUrlById: deps.findArticleUrlById,
	});

	function pollUrlBuilderForId(articleId: string): PollUrlBuilder {
		return {
			summary: (n) => `/queue/${articleId}/summary?poll=${n}`,
			reader: (n) => `/queue/${articleId}/reader?poll=${n}`,
		};
	}

	/** Public share-able permalink. Users copy this URL from the browser
	 * address bar to share an article, so any visitor — owner, different
	 * logged-in user, or anonymous — must land somewhere useful. Owners get
	 * their personalised reader (mark-as-read, progress). Everyone else is
	 * redirected to `/view/<original-url>`, the public route that already
	 * has full OG/Twitter/Schema.org metadata so social-media previews
	 * unfurl correctly. Declared BEFORE `router.use(deps.dualAuth)` so the
	 * auth middleware doesn't pre-empt anonymous traffic with a /login
	 * redirect. */
	router.get("/:id/read", async (req: Request, res: Response) => {
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

		await deps.updateArticleStatus(ownedArticle.id, ownedArticle.userId, "read");

		const audioEnabled = deps.featureToggle.isEnabled(req, "audio");
		const state = await reader.resolveReaderState({
			article: {
				url: ownedArticle.url,
				metadata: ownedArticle.metadata,
				estimatedReadTime: ownedArticle.estimatedReadTime,
			},
			pollUrlBuilder: pollUrlBuilderForId(ownedArticle.id.value),
		});

		sendComponent(
			req, res,
			Base(ReaderPage({ ...ownedArticle, content: state.content }, {
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				progress: state.progress,
				audioEnabled,
				extensionInstallUrl: extensionInstallUrlIfMissing(req),
			}), bannerStateFromRequest(req)),
		);
	});

	router.use(deps.dualAuth);

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

		const saveError = deps.httpErrorMessageMapping(req.query);
		const importFlash = importFlashMapping(req.query);
		const importSkipped = readImportSkippedFlash(req, res);
		const [summaryByUrl, crawlByUrl, unreadCount] = await Promise.all([
			loadSummaries(deps.findGeneratedSummary, result.articles),
			loadCrawls(deps.findArticleCrawlStatus, result.articles),
			urlState.tab === "queue"
				? Promise.resolve(result.total)
				: deps.findArticlesByUser({ userId, status: "unread", page: 1, pageSize: 1 }).then(r => r.total),
		]);
		const vm = toQueueViewModel(result, urlState, {
			unreadCount,
			errors: saveError ? [{ message: saveError }] : undefined,
			importFlash,
			importSkipped,
			summaryByUrl,
			crawlByUrl,
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
		/** Most recent save in the listing is at index 0 (queue defaults to
		 * sort=savedAt order=desc). Re-use the already-loaded crawl/summary
		 * snapshots — no extra DynamoDB roundtrip. Empty queue → no banner. */
		const mostRecent = result.articles[0];
		const showExtensionSuggestionBanner = mostRecent
			? !isFullyParsed({
					crawlStatus: crawlByUrl.get(mostRecent.url)?.status,
					summaryStatus: summaryByUrl.get(mostRecent.url)?.status,
				})
			: false;
		sendComponent(
			req, res,
			Base(
				QueuePage(vm, { saveUrl: filterUrl, extensionInstalled, extensionSavedArticle, browser, onboardingDismissed }),
				{ ...bannerStateFromRequest(req), showExtensionSuggestionBanner, extensionInstalled },
			),
		);
	});

	router.post("/dismiss-onboarding", (_req: Request, res: Response) => {
		res.cookie(DISMISS_COOKIE_NAME, ONBOARDING_VERSION, { path: "/", maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: "lax", httpOnly: true });
		res.redirect(303, "/queue");
	});

	router.post("/", express.json(), async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateSaveableUrl(submittedUrl);
		const prefersRepresentation = req.get("Prefer") === "return=representation";

		if (validation.status === "ERROR") {
			if (validation.error.code === "malformed_url") {
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "invalid-url", message: validation.error.message }),
				);
				return;
			}
			if (prefersRepresentation) {
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
			/** Legacy extension without Prefer header — fall through to the
			 * pre-validator stub-save behaviour for backwards compatibility. */
		}

		try {
			if (validation.status === "SUCCESS") {
				const freshness = await deps.refreshArticleIfStale({ url: validation.url });
				const result = await saveArticleFromUrl(deps, { userId, url: validation.url, freshness });
				markExtensionSavedArticle(res);
				res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
				return;
			}
			const freshness = await deps.refreshArticleIfStale({ url: submittedUrl });
			const result = await saveUnsaveableUrlStub(deps, { userId, url: submittedUrl, freshness });
			markExtensionSavedArticle(res);
			res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
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
							href: "/queue",
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

	router.post("/save-html", express.json({ limit: MAX_RAW_HTML_REQUEST_BYTES }), saveHtmlLimitHandler, async (req: Request, res: Response) => {
		if (!wantsSiren(req)) {
			res.status(406).send("Not Acceptable");
			return;
		}

		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

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

			const freshness = await deps.refreshArticleIfStale({ url: articleUrl });

			await deps.putPendingHtml({ url: articleUrl, html: parsed.data.rawHtml });
			await deps.publishSaveLinkRawHtmlCommand({
				url: articleUrl,
				userId,
				title: parsed.data.title,
			});

			const result = await saveArticleFromUrl(deps, { userId, url: articleUrl, freshness });
			markExtensionSavedArticle(res);
			res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
		} catch (error) {
			deps.logError("Failed to save article from html", error instanceof Error ? error : undefined);
			res.status(500).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "save-failed", message: "Could not save article" }),
			);
		}
	});

	router.post("/save", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const submittedUrl = typeof req.body?.url === "string" ? req.body.url : "";
		const validation = deps.validateSaveableUrl(submittedUrl);

		if (validation.status === "ERROR") {
			const urlState = parseQueueUrl({});
			const result = await deps.findArticlesByUser({ userId });
			const unreadCount = (await deps.findArticlesByUser({ userId, status: "unread", page: 1, pageSize: 1 })).total;
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
			sendComponent(req, res, Base(QueuePage(vm, { statusCode: 422 }), bannerStateFromRequest(req)));
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: validation.url });
			await saveArticleFromUrl(deps, { userId, url: validation.url, freshness });
			res.redirect(303, "/queue#latest-saved");
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			res.redirect(303, "/queue?error_code=save_failed");
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

		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleSummaryPoll({
			articleUrl: article.url,
			pollCount,
			pollUrlBuilder: pollUrlBuilderForId(article.id.value),
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
			maxPolls: MAX_CARD_POLLS,
		});
		const html = renderQueueCard(
			toQueueCardDisplayModel(articleVm, { isFirst: false }),
		);
		res.status(200).type("html").send(html);
	});

	router.post("/:id/status", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const parsedStatus = ArticleStatusSchema.safeParse(req.body.status);

		if (parsedId.success && parsedStatus.success) {
			await deps.updateArticleStatus(parsedId.data, userId, parsedStatus.data);
		}

		res.redirect(303, buildQueueUrl(parseQueueUrl(req.query)));
	});

	router.post("/:id/delete", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);

		if (parsedId.success) {
			await deps.deleteArticle(parsedId.data, userId);
		}

		/** Chrome extension v1.0.66 (in the web store) sends this request with `redirect: "manual"` and only treats `status === 204` as success — a 303 surfaces to JS as an opaqueredirect with status 0, leaving the deleted row on screen until the popup is reopened. Newer extensions opt into the redirect-and-follow flow with `Prefer: return=representation` (RFC 7240) so they receive the refreshed Siren collection. Drop the 204 branch once v1.0.66 ages out of the wild. */
		const prefersRepresentation = req.get("Prefer") === "return=representation";
		if (wantsSiren(req) && !prefersRepresentation) {
			res.status(204).send();
			return;
		}

		res.redirect(303, buildQueueUrl(parseQueueUrl(req.query)));
	});

	return router;
}
