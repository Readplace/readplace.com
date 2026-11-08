
import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import { z } from "zod";
import type { SaveableUrl, } from "@packages/domain/article";
import {
	type EmailLinkOrdinal,
	EmailLinkOrdinalSchema,
	parseEmailIssueArticleUrl,
} from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import { newSaveAttemptId, } from "@packages/domain/article";
import { hashIp, } from "@packages/web-analytics";
import { viewerOf } from "@packages/viewer-identity";
import { ANALYTICS_EVENTS, STREAMS, } from "../../../observability/events";
import { appClientOf, } from "../../shared/save-client";
import { ReaderArticleHashIdSchema, nextReadDismissalOf } from "@packages/domain/article";
import { ownedEnclosure, viewerFor } from "@packages/domain/article";
import { parseCaptureWatch } from "../../shared/article-reader/capture-watch";
import { transcriptNoticeOf } from "../../shared/article-reader/reader-view";
import { renderReaderDownloadsOob, renderReaderDownloadsSlotOob } from "../../shared/article-body/reader-actions/reader-actions.component";
import type { PollHighlights, ReaderViewFailedOob } from "../../shared/article-reader/article-reader.types";
import {
	sendComponent,
	toRelativeOrDate,
} from "@packages/web-shell";
import { requireNotLocked } from "../../middleware/require-not-locked.middleware";
import { CacheableComponent, } from "../../conditional-get";
import {
	NO_READER_VIEW_FAILED_OOB,
	extensionSuggestionBannerOob,
} from "../../shared/article-reader/reader-view-failed-oob";
import {
	READLIST_PATH,
} from "./readlist.url";
import {
	DEFAULT_READLIST_SLUG,
} from "@packages/domain/readlist";
import { HtmlPage } from "@packages/web-shell";
import { MAX_POLLS } from "@packages/web-shell";
import { parsePollParam } from "@packages/web-shell";
import { renderNextRead } from "../../shared/next-read/next-read.component";
import { renderPastReadsSection } from "../../shared/past-reads/past-reads.component";
import { safeReturnPath } from "../../shared/safe-return-path";
import {
	extensionInstallUrlIfMissing,
} from "../../onboarding/extension-install";
import {
	nativeSurfaceQuery,
} from "../../onboarding/native-client";
import type { SavedArticle } from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { initReaderHighlightOptions } from "./reader-highlight-options";
import { initRequestRelatedPasses } from "./request-related-passes";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { type ReadlistShared, relatedPollUrlFor, loadRelatedArticles, pastReadsPollUrlFor, loadPastReads, pastReadsPresentation, isAppPlatform, ISSUE_LINK_SAVED_PARAM, downloadsOwnerEpub, readerEpubHrefFor } from "./readlist-shared";

const HTMX_STOP_POLLING_STATUS = 286;

export function initReaderPanelRoutes(
	deps: Pick<
		ReadlistDependencies,
		"findArticleById" | "markArticleViewed" | "now" | "resolveReaderProvenance" | "findRelatedArticles" | "logError" | "markRelatedDismissed" | "findIssueLink" | "validateNewSaveUrl" | "requireWriteAccess" | "refreshArticleIfStale" | "publishSubmitLink" | "appOrigin" | "findPastReads" | "publishComputeRelatedPastReads" | "publishComputeRelatedPasses" | "readRelatedPassRequestState" | "markRelatedPassesRequested" | "recordEngagementActivity" | "markSummaryToggled" | "recordAnalyticsEvent" | "salt" | "listArticleHighlights" | "readCanonicalSnapshot" | "canSaveContent"
	>,
	shared: ReadlistShared,
): Router {
	const router = express.Router();
	const requestRelatedPasses = initRequestRelatedPasses(deps);
	const readerHighlightOptions = initReaderHighlightOptions(deps);
	const { saveArticleAtReadlistTop, requestReadlistContext, reader, pollUrlBuilderFor, ownerReaderSection, readerPathFor, readerPathForReadlist, readerReturnPath, epubGuideFor } = shared;

	const ownerReaderViewFailedOob = (req: Request): ReaderViewFailedOob =>
		isAppPlatform(req)
			? NO_READER_VIEW_FAILED_OOB
			: extensionSuggestionBannerOob(req);

	const downloadsOobFor = (req: Request, article: SavedArticle): ((articleUrl: string) => string) | undefined =>
		parseEmailIssueArticleUrl(article.url) === undefined
			? (articleUrl) =>
					downloadsOwnerEpub(req)
						? renderReaderDownloadsSlotOob({
								downloadHref: readerEpubHrefFor(req, { article, appClient: appClientOf(req) }),
								guide: epubGuideFor(req, article),
								placements: ["toolbar", "menu"],
							})
						: renderReaderDownloadsOob({ articleUrl, appClient: appClientOf(req), guide: epubGuideFor(req, article) })
			: undefined;

	const pollHighlightsFor = async (req: Request, article: SavedArticle): Promise<PollHighlights> =>
		readerHighlightOptions(req, {
			article,
			rows: await deps.listArticleHighlights({
				userId: article.userId,
				url: ArticleResourceUniqueId.parse(article.url).value,
			}),
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
			viewer: viewerFor(userId),
			enclosure: ownedEnclosure({ viewer: viewerFor(userId), article }),
			articleId: article.id.value,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(req, article.id.value),
			readerSection: ownerReaderSection(req, article.id.value),
			capture: parseCaptureWatch(req.query),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${READLIST_PATH}/${article.id.value}/summary-toggle`,
			provenance: await deps.resolveReaderProvenance(article.provenance),
			readerNotice: transcriptNoticeOf(article.media),
			saved: toRelativeOrDate({ iso: article.savedAt.toISOString(), now: deps.now() }),
			readerViewFailedOob: ownerReaderViewFailedOob(req),
			renderDownloadsOob: downloadsOobFor(req, article),
			highlights: await pollHighlightsFor(req, article),
		});
		res.vary("User-Agent");
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
			viewer: viewerFor(userId),
			enclosure: ownedEnclosure({ viewer: viewerFor(userId), article }),
			articleId: article.id.value,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(req, article.id.value),
			readerSection: ownerReaderSection(req, article.id.value),
			capture: parseCaptureWatch(req.query),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: `${READLIST_PATH}/${article.id.value}/summary-toggle`,
			provenance: await deps.resolveReaderProvenance(article.provenance),
			readerNotice: transcriptNoticeOf(article.media),
			saved: toRelativeOrDate({ iso: article.savedAt.toISOString(), now: deps.now() }),
			readerViewFailedOob: ownerReaderViewFailedOob(req),
			renderDownloadsOob: downloadsOobFor(req, article),
			highlights: await pollHighlightsFor(req, article),
		});
		res.vary("User-Agent");
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
			res.status(HTMX_STOP_POLLING_STATUS).type("html").send("");
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
				dismissal: nextReadDismissalOf(article),
			},
			pollUrl:
				pollCount < MAX_POLLS
					? relatedPollUrlFor({
							articleId: article.id.value,
							pollCount: pollCount + 1,
							surfaceQuery: nativeSurfaceQuery(req),
						})
					: undefined,
			returnTo: readerReturnPath(req, article.id.value),
			readerPathFor: readerPathFor(req),
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

	const resolveIssueLinkSave = async (
		req: Request<{ id: string }>,
		userId: UserId,
	): Promise<{ article: SavedArticle; ordinal: EmailLinkOrdinal; url: SaveableUrl } | undefined> => {
		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const ordinal = EmailLinkOrdinalSchema.safeParse(req.body.ordinal);
		if (!parsedId.success || !ordinal.success) return undefined;
		const article = await deps.findArticleById(parsedId.data, userId);
		if (article === null) return undefined;
		const issue = parseEmailIssueArticleUrl(article.url);
		if (issue === undefined) return undefined;
		const link = await deps.findIssueLink({ userId, receivedAtMessageId: issue.receivedAtMessageId, ordinal: ordinal.data });
		if (link === undefined) return undefined;
		const validation = deps.validateNewSaveUrl(link.url);
		return validation.status === "SUCCESS" ? { article, ordinal: ordinal.data, url: validation.url } : undefined;
	};

	router.post("/:id/issue-links", requireNotLocked, deps.requireWriteAccess, async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;
		const target = await resolveIssueLinkSave(req, userId);
		if (target === undefined) {
			res.status(404).type("html").send("");
			return;
		}
		assert(target.article.provenance, "an issue is saved with its newsletter's provenance");
		const freshness = await deps.refreshArticleIfStale({ url: target.url });
		const saveAttemptId = newSaveAttemptId();
		if (freshness.action === "unresolved") {
			await deps.publishSubmitLink({ url: target.url, userId, provenance: target.article.provenance, readlist: DEFAULT_READLIST_SLUG, saveTrigger: "manual", saveAttemptId });
		} else {
			await saveArticleAtReadlistTop({
				userId,
				url: target.url,
				freshness,
				provenance: target.article.provenance,
				saveTrigger: "manual",
				saveAttemptId,
			});
		}
		const returnTo = new URL(safeReturnPath(req.body.returnTo), deps.appOrigin);
		returnTo.searchParams.set(ISSUE_LINK_SAVED_PARAM, target.ordinal);
		res.redirect(303, `${returnTo.pathname}${returnTo.search}#issue-links`);
	});

	// Poll fragment for the "Previously read on this topic" section. A pure read,
	// like the Next-read poll — it never triggers computation. Its own poll budget
	// is independent of Next-read dismissal.
	router.get("/:id/topic-reads", async (req: Request, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (!article) {
			res.status(HTMX_STOP_POLLING_STATUS).type("html").send("");
			return;
		}

		const pollCount = parsePollParam(req.query.poll, MAX_POLLS);
		const sourceReadlist = requestReadlistContext(req).state.readlist;
		const { pastReads, budgetBlocked } = pastReadsPresentation({
			pastReads: await loadPastReads(
				deps.findPastReads,
				article,
				sourceReadlist,
				deps.logError,
			),
			now: deps.now(),
		});
		const pastReadsInput = {
			pastReads,
			sourceArticleId: article.id.value,
			now: deps.now(),
			readerPathForReadlist: readerPathForReadlist(req),
		};
		const railHtml = renderPastReadsSection({
			...pastReadsInput,
			placement: {
				kind: "rail",
				pollUrl:
					!budgetBlocked && pollCount < MAX_POLLS
						? pastReadsPollUrlFor({
								articleId: article.id.value,
								pollCount: pollCount + 1,
								surfaceQuery: nativeSurfaceQuery(req),
							})
						: undefined,
			},
		});
		const inlineHtml = renderPastReadsSection({
			...pastReadsInput,
			placement: { kind: "inline", oob: true },
		});
		const html = `${railHtml}\n${inlineHtml}`;
		sendComponent(req, res, CacheableComponent(HtmlPage(html), req));
	});

	// The worker fingerprint-guards, so re-firing on every visit is cheap when
	// nothing changed. htmx fires it on load and ignores the reply (204); the
	// no-JS fallback form lands back on the reader (303).
	router.post("/:id/topic-reads", requireNotLocked, deps.requireWriteAccess, async (req: Request<{ id: string }>, res: Response) => {
		assert(req.userId, "userId required - route must be protected by requireAuth");
		const userId = req.userId;

		const parsedId = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = parsedId.success
			? await deps.findArticleById(parsedId.data, userId)
			: null;

		if (article) {
			const sourceReadlist = requestReadlistContext(req).state.readlist;
			await requestRelatedPasses({
				url: article.url,
				userId,
				...(sourceReadlist === DEFAULT_READLIST_SLUG
					? {}
					: { readlist: sourceReadlist }),
			});
		}

		if (req.get("HX-Request") !== undefined) {
			res.status(204).end();
			return;
		}
		res.redirect(303, readerReturnPath(req, req.params.id));
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

		if (parsedState.data === "open") {
			await deps.recordEngagementActivity({
				userId,
				kind: "summary-open",
				at: deps.now(),
				articleId: article.id,
				campaignId: article.suggestionAttribution?.campaignId,
			});
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

	return router;
}
