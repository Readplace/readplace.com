import assert from "node:assert";
import {
	DISMISS_COOKIE_NAME,
	SAVE_COOKIE_NAME,
	SAVE_COOKIE_VALUE,
} from "@packages/onboarding-extension-signal";
import type { ErrorRequestHandler, Request, Response, Router } from "express";
import express from "express";
import type { LogParseError } from "@packages/hutch-infra-components";
import { SaveArticleInputSchema, SaveHtmlInputSchema, ArticleStatusSchema, MAX_RAW_HTML_REQUEST_BYTES, RAW_HTML_FIELD, isSaveableUrl } from "@packages/domain/article";
import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { RefreshArticleIfStale } from "@packages/test-fixtures/providers/article-freshness";
import type {
	DeleteArticle,
	FindArticleById,
	FindArticlesByUser,
	SaveArticle,
	UpdateArticleStatus,
} from "@packages/test-fixtures/providers/article-store";
import type { PublishUpdateFetchTimestamp } from "@packages/test-fixtures/providers/events";
import type { ReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import type {
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
import { saveArticleFromUrl } from "../../shared/save-article/save-article-from-url";
import { renderPage } from "../../render-page";
import { sendComponent } from "../../send-component";
import { wantsSiren } from "../../content-negotiation";
import { SIREN_MEDIA_TYPE, sirenError } from "../../api/siren";
import { toArticleCollectionEntity } from "../../api/collection-siren";
import { toArticleEntity } from "../../api/article-siren";
import { parseQueueUrl, buildQueueUrl } from "./queue.url";
import { tabQuery } from "./queue.tabs";
import type { HttpErrorMessageMapping } from "./queue.error";
import { importFlashMapping } from "./queue.error";
import { toQueueViewModel } from "./queue.viewmodel";
import { QueuePage } from "./queue.component";
import { ReaderPage } from "../reader/reader.component";
import { ONBOARDING_VERSION } from "../../onboarding/onboarding.steps";
import {
	detectBrowser,
	extensionInstallUrlIfMissing,
	isExtensionInstalled,
	isExtensionSavedArticle,
} from "../../onboarding/extension-install";

function markExtensionSavedArticle(res: Response): void {
	// Only Siren-only save endpoints call this; the form-based /queue/save path doesn't, so the onboarding step is gated on extension saves alone.
	res.cookie(SAVE_COOKIE_NAME, SAVE_COOKIE_VALUE, {
		path: "/",
		maxAge: 365 * 24 * 60 * 60 * 1000,
		sameSite: "lax",
		httpOnly: true,
	});
}

interface QueueDependencies {
	findArticlesByUser: FindArticlesByUser;
	findArticleById: FindArticleById;
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
	logError: (message: string, error?: Error) => void;
	logParseError: LogParseError;
	now: () => Date;
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

export function initQueueRoutes(deps: QueueDependencies): Router {
	const router = express.Router();

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

		const unreadCount = urlState.tab === "queue"
			? result.total
			: (await deps.findArticlesByUser({ userId, status: "unread", page: 1, pageSize: 1 })).total;
		const saveError = deps.httpErrorMessageMapping(req.query);
		const importFlash = importFlashMapping(req.query);
		const summaryByUrl = await loadSummaries(deps.findGeneratedSummary, result.articles);
		const vm = toQueueViewModel(result, urlState, { unreadCount, saveError, importFlash, summaryByUrl });
		const extensionInstalled = isExtensionInstalled(req);
		const extensionSavedArticle = isExtensionSavedArticle(req);
		/** Dismissal only counts when the extension is also installed in *this* browser.
		 * The dismiss button only appears once every step (including install-extension)
		 * is complete, so a dismiss without the install cookie means the user is in a
		 * different browser context (or has lost the install cookie) — show the popup
		 * again so they can install the extension here. */
		const onboardingDismissed = extensionInstalled && req.cookies?.[DISMISS_COOKIE_NAME] === ONBOARDING_VERSION;
		const browser = detectBrowser(req);
		const showImportForm = req.query.feature === "import";
		sendComponent(
			res,
			renderPage(req, QueuePage(vm, { saveUrl: filterUrl, extensionInstalled, extensionSavedArticle, browser, onboardingDismissed, showImportForm })),
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
		const parsed = SaveArticleInputSchema.safeParse(req.body);

		if (!parsed.success) {
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				sirenError({ code: "invalid-url", message: "Please enter a valid URL" }),
			);
			return;
		}

		const prefersRepresentation = req.get("Prefer") === "return=representation";
		if (prefersRepresentation && !isSaveableUrl(parsed.data.url)) {
			/** Non-saveable scheme (chrome://, about:, file:, ...). The crawler can't
			 * reach these, so a save would only persist a broken stub. Hand the
			 * client the current collection and let it drop the user back into the
			 * list view silently. Gated on Prefer: return=representation so old
			 * extensions (which can't interpret a collection on POST) keep the
			 * pre-existing stub-save behaviour and don't lock up on 422. */
			const collection = await deps.findArticlesByUser({ userId });
			res.status(422).type(SIREN_MEDIA_TYPE).json(
				toArticleCollectionEntity(collection, {
					page: collection.page,
					pageSize: collection.pageSize,
				}),
			);
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: parsed.data.url });
			const result = await saveArticleFromUrl(deps, { userId, url: parsed.data.url, freshness });
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
				if (urlOnly?.success) {
					const rawHtml: unknown = req.body?.rawHtml;
					const sizeBytes = typeof rawHtml === "string" ? rawHtml.length : 0;
					/* logError (not warn) on purpose: feeds the alarm so oversize Tier-0
					 * captures stay visible — they're the signal for raising MAX_RAW_HTML_BYTES. */
					deps.logError(
						`[SaveHtmlOversize] falling back to URL-only url=${urlOnly.data.url} userId=${userId} sizeBytes=${sizeBytes}`,
					);
					const freshness = await deps.refreshArticleIfStale({ url: urlOnly.data.url });
					const result = await saveArticleFromUrl(deps, { userId, url: urlOnly.data.url, freshness });
					markExtensionSavedArticle(res);
					res.status(201).type(SIREN_MEDIA_TYPE).json(toArticleEntity(result.saved));
					return;
				}
				res.status(422).type(SIREN_MEDIA_TYPE).json(
					sirenError({ code: "invalid-save-html", message: "Invalid save-html request" }),
				);
				return;
			}

			const freshness = await deps.refreshArticleIfStale({ url: parsed.data.url });

			await deps.putPendingHtml({ url: parsed.data.url, html: parsed.data.rawHtml });
			await deps.publishSaveLinkRawHtmlCommand({
				url: parsed.data.url,
				userId,
				title: parsed.data.title,
			});

			const result = await saveArticleFromUrl(deps, { userId, url: parsed.data.url, freshness });
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
		const parsedBody = SaveArticleInputSchema.safeParse(req.body);

		if (!parsedBody.success) {
			const urlState = parseQueueUrl({});
			const result = await deps.findArticlesByUser({ userId });
			const unreadCount = (await deps.findArticlesByUser({ userId, status: "unread", page: 1, pageSize: 1 })).total;
			const summaryByUrl = await loadSummaries(deps.findGeneratedSummary, result.articles);
			const vm = toQueueViewModel(result, urlState, {
				saveError: "Please enter a valid URL",
				unreadCount,
				summaryByUrl,
			});
			sendComponent(res, renderPage(req, QueuePage(vm, { statusCode: 422 })));
			return;
		}

		try {
			const freshness = await deps.refreshArticleIfStale({ url: parsedBody.data.url });
			await saveArticleFromUrl(deps, { userId, url: parsedBody.data.url, freshness });
			res.redirect(303, "/queue#latest-saved");
		} catch (error) {
			deps.logError("Failed to save article", error instanceof Error ? error : undefined);
			res.redirect(303, "/queue?error_code=save_failed");
		}
	});

	const reader = initArticleReader(deps);

	function pollUrlBuilderForId(articleId: string): PollUrlBuilder {
		return {
			summary: (n) => `/queue/${articleId}/summary?poll=${n}`,
			reader: (n) => `/queue/${articleId}/reader?poll=${n}`,
		};
	}

	router.get("/:id/read", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.redirect(303, "/queue");
			return;
		}

		if (article.status === "unread") {
			await deps.updateArticleStatus(article.id, userId, "read");
		}

		const audioEnabled = req.query.feature === "audio";
		const state = await reader.resolveReaderState({
			article: {
				url: article.url,
				metadata: article.metadata,
				estimatedReadTime: article.estimatedReadTime,
			},
			pollUrlBuilder: pollUrlBuilderForId(article.id.value),
		});

		sendComponent(
			res,
			renderPage(req, ReaderPage({ ...article, content: state.content }, {
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				progress: state.progress,
				audioEnabled,
				extensionInstallUrl: extensionInstallUrlIfMissing(req),
			})),
		);
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
		sendComponent(res, component);
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
		sendComponent(res, component);
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
