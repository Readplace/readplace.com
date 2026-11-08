
import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import {
	EmailLinkOrdinalSchema,
	inboxEmailPath,
	parseEmailIssueArticleUrl,
} from "@packages/domain/inbox";
import type { IssueLinksSectionInput } from "../../shared/issue-links/issue-links.component";
import type {
	ResolveReaderProvenance,
} from "../../shared/article-body/article-header/resolve-reader-provenance";
import type { UserId } from "@packages/domain/user";
import { appClientOf, } from "../../shared/save-client";
import { FILED_READLIST_PARAM } from "../../shared/filing-flash";
import { calculateReadTime, hostStubMetadata, } from "@packages/domain/article";
import { ABSENT_ENCLOSURE, ReaderArticleHashIdSchema, mayReadItem, ownedEnclosure, viewerFor } from "@packages/domain/article";
import { MediaImageFileSchema, PrivateItemUrlSchema, uploadIdOfPrivateItemUrl } from "@packages/media-contracts";
import { readerContentUnavailable, readerNoticeOf, transcriptNoticeOf } from "../../shared/article-reader/reader-view";
import type {
	PastReads,
	RelatedArticles,
} from "@packages/provider-contracts/related-articles";
import { Base, ChromelessPage } from "../../base.component";
import { NotFoundPage } from "../not-found";
import {
	FETCH_CHANGELOG_BANNER_IN_BROWSER,
	requireCspNonce,
	sendComponent,
	withInternalTracking,
} from "@packages/web-shell";
import type { Component, CspNonce } from "@packages/web-shell";
import { noindexMiddleware } from "../../middleware/noindex.middleware";
import { RedirectComponent, type Redirect } from "../../redirect.component";
import { FreshForComponent } from "../../conditional-get";
import { initReaderPermalink } from "./reader-permalink";
import { initOwnerArticleMarkdown, isDeliberateReaderRequest } from "./reader-markdown";
import { initOwnerArticleEpub } from "./reader-epub";
import type { BuildArticleEpub } from "../../shared/epub/article-epub";
import {
	parseReadlistUrl,
	READLIST_PATH,
	readlistReturnQuery,
} from "./readlist.url";
import { type ArticleDeletion, buildArticleDeletion } from "./readlist-card/delete-confirm.component";
import {
	ReadlistSlugSchema,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type {
	ReaderReadlistFiling,
} from "./reader-readlist-filing";
import { computeArticleContentVersion, withHighlightsVersion } from "../../shared/article-content-version";
import { readerCachePolicy } from "./reader-cache-policy";
import { VIEW_BACK_LINK } from "./reader-skeleton/reader-skeleton.component";
import type { PageBody } from "@packages/web-shell";
import { ReaderPage, type ReaderPageHighlights } from "../reader/reader.component";
import { isPrefetchRequest } from "../../shared/prefetch-request";
import { isBotUserAgent } from "@packages/web-analytics";
import { requestCanCapture } from "../../onboarding/capture-capable-request";
import { OFFLINE_READER_SCRIPT } from "../../shared/offline-reader/offline-reader-script";
import { ARTICLE_VERSION_HEADER } from "../../shared/offline-reader/offline-cache";
import { offlineCopyRowScript } from "../../shared/article-body/article-history/offline-copy-row-script";
import {
	extensionInstallUrlIfMissing,
	canOfferExtensionInstall,
	isExtensionInstalled,
} from "../../onboarding/extension-install";
import {
	nativeSurfaceQuery,
} from "../../onboarding/native-client";
import { EXIT_CONFIRM_SCOPE } from "../reader/reader-exit-confirm.component";
import { MARKED_READ_EVENT } from "../reader/reader-exit-confirm.client";
import { APP_BACK_LINK } from "../../shared/native-app-links";
import type { SavedArticle } from "@packages/domain/article";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReadlistDependencies } from "./readlist-dependencies.types";
import { highlightFeatureEnabled } from "./highlight-feature";
import { highlightActionUrl } from "./highlight-surface";
import { highlightFormScopeFor, initReaderHighlightOptions } from "./reader-highlight-options";
import { type ReadlistShared, joinedSurfaceQuery, relatedPollUrlFor, loadRelatedArticles, pastReadsPollUrlFor, loadPastReads, pastReadsPresentation, isAppPlatform, readerReadlistFilingFrom, ISSUE_LINK_SAVED_PARAM, readerEpubHrefFor } from "./readlist-shared";

const pastReadsComputeUrlFor = (params: {
	articleId: string;
	surfaceQuery: string;
}): string => {
	const surface = joinedSurfaceQuery(params.surfaceQuery);
	return `${READLIST_PATH}/${params.articleId}/topic-reads${surface === "" ? "" : `?${params.surfaceQuery}`}`;
};

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

const readerStatusChangedBridgeScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {${readerBridgePostFn}
	document.addEventListener("${MARKED_READ_EVENT}", function () {
		post({ type: "statusChanged" });
	});
})();
</script>`;

const readerCaptureBridgeScript = (cspNonce: CspNonce) => `<script nonce="${cspNonce}">
(function () {${readerBridgePostFn}
	var offered = false;
	function offerCapture() {
		if (offered) { return; }
		if (!document.querySelector("[data-reader-capture].article-body__reader-notice-capture--offered")) { return; }
		offered = true;
		post({ type: "captureAvailable" });
	}
	function run() {
		document.documentElement.setAttribute("data-reader-capture-host", "");
		offerCapture();
		document.body.addEventListener("htmx:afterSettle", offerCapture);
	}
	document.body.addEventListener("click", function (event) {
		var target = event.target;
		var button = target && target.closest ? target.closest("[data-reader-capture]") : null;
		if (!button) { return; }
		post({ type: "captureBlocked" });
	});
	if (window.htmx) { run(); return; }
	document.body.addEventListener("htmx:load", run, { once: true });
})();
</script>`;

export type RenderOwnerReader = (
	req: Request<{ id: string }>,
	res: Response,
	options: {
		statusCode: 200 | 422;
		toast: string | undefined;
		markViewed: boolean;
	},
) => Promise<void>;

function withStatusCode(component: Component, statusCode: number): Component {
	return { to: (mediaType) => ({ ...component.to(mediaType), statusCode }) };
}

function withOfflineReading(page: PageBody, cspNonce: CspNonce): PageBody {
	assert(page.scripts, "the reader page always sets its scripts");
	return { ...page, scripts: page.scripts + OFFLINE_READER_SCRIPT + offlineCopyRowScript(cspNonce) };
}


export function initReaderPageRoutes(deps: Pick<
		ReadlistDependencies,
		"findArticleUrlById" | "findArticleByUrl" | "findItemOwner" | "presignMediaImage" | "listUserSavesForUrl" | "appOrigin" | "listIssueLinks" | "findIssueLinkSaveStates" | "dualAuth" | "listReadlistDefinitions" | "getOnboardingSignals" | "now" | "findRelatedArticles" | "logError" | "findPastReads" | "resolveReaderProvenance" | "markdownBearerAuth" | "buildBannerState" | "recordEngagementActivity" | "findUserById" | "chromelessReader" | "findArticleCrawlVersions" | "webReader" | "resolveOwnedArticle" | "findArticleCrawlStatus" | "findGeneratedSummary" | "readArticleContent" | "requestResolutionOnView" | "listArticleHighlights" | "readCanonicalSnapshot" | "presignEnclosure" | "findArticleById" | "canSaveContent"
	> & { buildArticleEpub: BuildArticleEpub }, shared: ReadlistShared): { router: Router; renderOwnerReader: RenderOwnerReader } {
	const router = express.Router();
	const readerHighlightOptions = initReaderHighlightOptions(deps);
	const { requestReadlistContext, storeFor, reader, pollUrlBuilderFor, ownerReaderSection, readerPathFor, readerPathForReadlist, readerReturnPath, epubGuideFor } = shared;

	const resolveReaderPermalinkIn = (readlist: ReadlistSlug) =>
		initReaderPermalink({
			readlist,
			findArticleById: storeFor(readlist).findArticleById,
			findArticleUrlById: deps.findArticleUrlById,
			findArticleByUrl: deps.findArticleByUrl,
			listUserSavesForUrl: deps.listUserSavesForUrl,
		});

	const withoutFiledFlash = (path: string): string => {
		const current = new URL(path, deps.appOrigin);
		if (!current.searchParams.has(FILED_READLIST_PARAM)) return path;
		current.searchParams.delete(FILED_READLIST_PARAM);
		return `${current.pathname}${current.search}`;
	};

	const issueLinksFor = async (req: Request, article: SavedArticle): Promise<IssueLinksSectionInput | undefined> => {
		const issue = parseEmailIssueArticleUrl(article.url);
		if (issue === undefined) return undefined;
		const { links, meta } = await deps.listIssueLinks({
			userId: article.userId,
			receivedAtMessageId: issue.receivedAtMessageId,
		});
		return {
			links,
			extraction: meta === undefined ? "pending" : meta.extractionFailed ? "failed" : "finished",
			saveStates: await deps.findIssueLinkSaveStates({ userId: article.userId, urls: links.map((link) => link.url) }),
			justSaved: EmailLinkOrdinalSchema.safeParse(req.query[ISSUE_LINK_SAVED_PARAM]).data,
			saveUrl: withInternalTracking(`${READLIST_PATH}/${article.id.value}/issue-links`, {
				source: "reader",
				content: "save-issue-link",
			}),
			returnTo: readerReturnPath(req, article.id.value),
			inboxHref: withInternalTracking(`${inboxEmailPath(issue.receivedAtMessageId)}?tab=articles`, {
				source: "reader",
				content: "open-issue-in-inbox",
			}),
		};
	};

	const epubHrefFor = (req: Request, article: SavedArticle, content: string | undefined): string | undefined =>
		content === undefined || parseEmailIssueArticleUrl(article.url) !== undefined
			? undefined
			: readerEpubHrefFor(req, { article, appClient: appClientOf(req) });

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

	const readerOwnerControlsFor = async (params: {
		userId: UserId;
		article: SavedArticle;
		returnTo: string;
		filed: ReadlistSlug | undefined;
	}): Promise<{ readlistFiling: ReaderReadlistFiling; deleteAcknowledged: boolean }> => {
		const [definitions, saves, signals] = await Promise.all([
			deps.listReadlistDefinitions(params.userId),
			deps.listUserSavesForUrl({ userId: params.userId, url: params.article.url }),
			deps.getOnboardingSignals({ userId: params.userId }),
		]);
		return {
			readlistFiling: readerReadlistFilingFrom({
				article: params.article,
				definitions,
				saves,
				signals,
				returnTo: params.returnTo,
				filed: params.filed,
			}),
			deleteAcknowledged: signals.deleteArticleAckedAt !== undefined,
		};
	};

	const readerDeletionFor = (req: Request, input: { articleId: string; acknowledged: boolean }): ArticleDeletion => {
		const query = [readlistReturnQuery(parseReadlistUrl(req.query)).slice(1), nativeSurfaceQuery(req)]
			.filter((part) => part !== "")
			.join("&");
		return buildArticleDeletion({
			articleId: input.articleId,
			query: query === "" ? "" : `?${query}`,
			acknowledged: input.acknowledged,
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
				previouslyRead: PastReads;
				previouslyReadPollUrl: string | undefined;
				previouslyReadBudgetBlocked: boolean;
				readlistFiling: ReaderReadlistFiling;
				deletion: ArticleDeletion;
				provenance: Awaited<ReturnType<ResolveReaderProvenance>>;
				contentVersion: string;
			};

	/** Ownership/access (owner → reader; non-owner or anonymous → permalink
	 * redirect) comes entirely from resolveReaderPermalink, so both the full-shell
	 * and the `?platform=ios` chromeless renders of `/view` inherit it identically.
	 * Stamps reader-view presence on the owner open — the only server-side signal
	 * that the reader was opened. */
	const readerStateOnOpen = async (
		req: Request<{ id: string }>,
		ownedArticle: SavedArticle,
	): Promise<ResolvedReaderState> => {
		const params = {
			viewer: viewerFor(req.userId),
			article: {
				url: ownedArticle.url,
				metadata: ownedArticle.metadata,
				estimatedReadTime: ownedArticle.estimatedReadTime,
			},
			pollUrlBuilder: pollUrlBuilderFor(req, ownedArticle.id.value),
		};
		if (!isDeliberateReaderRequest(req) || isBotUserAgent(req.get("user-agent"))) {
			return reader.resolveReaderState(params);
		}
		const { url } = ownedArticle;
		const [crawl, summary] = await Promise.all([
			deps.findArticleCrawlStatus(url),
			deps.findGeneratedSummary({ url, viewer: params.viewer }),
		]);
		const resolved = await deps.requestResolutionOnView({
			surface: "reader",
			viewer: params.viewer,
			viewerCanCapture: requestCanCapture(req),
			articles: [{ url, crawl, summary }],
		});
		return reader.resolveReaderStateFrom(params, resolved.get(url) ?? { crawl, summary });
	};

	const resolveOwnerReader = async (
		req: Request<{ id: string }>,
		options: { markViewed: boolean },
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

		if (options.markViewed && !isPrefetchRequest(req)) {
			await storeFor(readerReadlist).markArticleViewed({
				userId: ownedArticle.userId,
				url: ownedArticle.url,
				at: deps.now(),
			});
		}

		const [related, storedPreviouslyRead, state, { readlistFiling, deleteAcknowledged }, provenance] = await Promise.all([
			loadRelatedArticles(deps.findRelatedArticles, ownedArticle, deps.logError),
			loadPastReads(deps.findPastReads, ownedArticle, readerReadlist, deps.logError),
			readerStateOnOpen(req, ownedArticle),
			readerOwnerControlsFor({
				userId: ownedArticle.userId,
				article: ownedArticle,
				returnTo: readerReturnPath(req, ownedArticle.id.value),
				filed: isAppPlatform(req) ? undefined : ReadlistSlugSchema.safeParse(req.query[FILED_READLIST_PARAM]).data,
			}),
			deps.resolveReaderProvenance(ownedArticle.provenance),
		]);
		const relatedPollUrl =
			ownedArticle.relatedDismissedAt === undefined
				? relatedPollUrlFor({
						articleId: ownedArticle.id.value,
						pollCount: 1,
						surfaceQuery: nativeSurfaceQuery(req),
					})
				: undefined;
		// Never gated on Next-read dismissal — the topic section polls until its own
		// selection settles regardless of whether the end suggestion was dismissed.
		const { pastReads: previouslyRead, budgetBlocked: previouslyReadBudgetBlocked } = pastReadsPresentation({
			pastReads: storedPreviouslyRead,
			now: deps.now(),
		});
		const previouslyReadPollUrl = previouslyReadBudgetBlocked
			? undefined
			: pastReadsPollUrlFor({
					articleId: ownedArticle.id.value,
					pollCount: 1,
					surfaceQuery: nativeSurfaceQuery(req),
				});
		const contentVersion = computeArticleContentVersion({
			article: ownedArticle,
			crawl: state.crawl,
			summary: state.summary,
		});
		const deletion = readerDeletionFor(req, { articleId: ownedArticle.id.value, acknowledged: deleteAcknowledged });

		if (state.readerView.kind === "not-an-article") {
			return {
				kind: "ready",
				article: {
					...ownedArticle,
					content: undefined,
					metadata: { ...hostStubMetadata(ownedArticle.destinationUrl), wordCount: 0 },
					estimatedReadTime: calculateReadTime(0),
				},
				state,
				related: { status: "skipped" },
				relatedPollUrl: undefined,
				previouslyRead: { status: "ready", items: [] },
				previouslyReadPollUrl: undefined,
				previouslyReadBudgetBlocked: false,
				readlistFiling,
				deletion,
				provenance,
				contentVersion,
			};
		}

		return {
			kind: "ready",
			article: ownedArticle,
			state,
			related,
			relatedPollUrl,
			previouslyRead,
			previouslyReadPollUrl,
			previouslyReadBudgetBlocked,
			readlistFiling,
			deletion,
			provenance,
			contentVersion,
		};
	};

	router.get("/:id/media/:file", noindexMiddleware, async (req: Request<{ id: string; file: string }>, res: Response) => {
		const file = MediaImageFileSchema.safeParse(req.params.file);
		const id = ReaderArticleHashIdSchema.safeParse(req.params.id);
		if (!file.success || !id.success) {
			res.status(404).type("html").send("");
			return;
		}
		const url = PrivateItemUrlSchema.safeParse(await deps.findArticleUrlById(id.data));
		if (!url.success) {
			res.status(404).type("html").send("");
			return;
		}
		const ownerUserId = await deps.findItemOwner(url.data);
		if (!mayReadItem({ url: url.data, viewer: viewerFor(req.userId), ownerUserId })) {
			res.status(404).type("html").send("");
			return;
		}
		const location = await deps.presignMediaImage({ uploadId: uploadIdOfPrivateItemUrl(url.data), file: file.data });
		res.set("Cache-Control", "private, no-store");
		res.redirect(302, location);
	});

	router.get("/:id/enclosure", noindexMiddleware, async (req: Request<{ id: string }>, res: Response) => {
		const id = ReaderArticleHashIdSchema.safeParse(req.params.id);
		const article = id.success && req.userId ? await deps.findArticleById(id.data, req.userId) : null;
		const read = article ? ownedEnclosure({ viewer: viewerFor(req.userId), article }) : ABSENT_ENCLOSURE;
		if (read.kind === "absent") {
			res.status(404).type("html").send("");
			return;
		}
		const location = await deps.presignEnclosure({ object: read.enclosure.object, mediaType: read.enclosure.mediaType });
		res.set("Cache-Control", "private, no-store");
		res.redirect(302, location);
	});

	router.get(
		"/:id/view",
		noindexMiddleware,
		deps.markdownBearerAuth,
		initOwnerArticleMarkdown(deps),
		initOwnerArticleEpub(deps),
	);

	const renderOwnerReader: RenderOwnerReader = async (req, res, options) => {
		const resolved = await resolveOwnerReader(req, { markViewed: options.markViewed });
		if (resolved.kind === "redirect") {
			sendComponent(req, res, RedirectComponent(resolved.redirect));
			return;
		}

		if (resolved.kind === "not-found") {
			sendComponent(req, res, Base(NotFoundPage(), await deps.buildBannerState(req)));
			return;
		}

		if (options.markViewed && isDeliberateReaderRequest(req)) {
			await deps.recordEngagementActivity({
				userId: resolved.article.userId,
				kind: "reader-open",
				at: deps.now(),
				articleId: resolved.article.id,
				campaignId: resolved.article.suggestionAttribution?.campaignId,
			});
		}
		const {
			article: ownedArticle,
			state,
			related,
			relatedPollUrl,
			previouslyRead,
			previouslyReadPollUrl,
			previouslyReadBudgetBlocked,
			readlistFiling,
			deletion,
			provenance,
		} = resolved;
		const highlightRows = highlightFeatureEnabled(req.query)
			? await deps.listArticleHighlights({
					userId: ownedArticle.userId,
					url: ArticleResourceUniqueId.parse(ownedArticle.url).value,
				})
			: [];
		const contentVersion = withHighlightsVersion({
			contentVersion: resolved.contentVersion,
			highlights: highlightRows,
		});
		const highlights: ReaderPageHighlights | undefined = await readerHighlightOptions(req, {
			article: ownedArticle,
			rows: highlightRows,
		});
		const settle = (component: Component, cacheControl: string): Component =>
			options.statusCode === 200
				? FreshForComponent(component, {
						ifNoneMatch: req.get("If-None-Match"),
						cspNonce,
						cacheControl,
					})
				: withStatusCode(component, options.statusCode);
		const pastReadsOptions = {
			previouslyRead,
			previouslyReadPollUrl,
			previouslyReadComputeUrl:
				previouslyReadBudgetBlocked || (isAppPlatform(req) && isPrefetchRequest(req))
					? undefined
					: pastReadsComputeUrlFor({
							articleId: ownedArticle.id.value,
							surfaceQuery: nativeSurfaceQuery(req),
						}),
			readerPathForReadlist: readerPathForReadlist(req),
		};

		const cspNonce = requireCspNonce(req);
		const currentPath =
			options.statusCode === 200
				? withoutFiledFlash(req.originalUrl)
				: highlightActionUrl({
						path: `${READLIST_PATH}/${ownedArticle.id.value}/view`,
						...highlightFormScopeFor(req, ownedArticle.id.value),
						enabled: true,
					});
		const issueLinks = await issueLinksFor(req, ownedArticle);
		const readerSettled =
			state.readerPollUrl === undefined &&
			state.summaryPollUrl === undefined &&
			related.status !== "pending";
		const readerCacheControl = readerCachePolicy({
			requestedVersion: req.query.v,
			currentVersion: contentVersion,
			settled: readerSettled,
		});

		res.set(ARTICLE_VERSION_HEADER, contentVersion);

		if (isAppPlatform(req)) {
			const appearance = (await deps.findUserById(ownedArticle.userId))?.appearance ?? "system";
			const readerBody = ReaderPage(ownedArticle, {
				appOrigin: deps.appOrigin,
				enclosure: ownedEnclosure({ viewer: viewerFor(req.userId), article: ownedArticle }),
				readerSection: ownerReaderSection(req, ownedArticle.id.value),
				content: state.content,
				summary: state.summary,
				summaryPollUrl: state.summaryPollUrl,
				crawl: state.crawl,
				readerPollUrl: state.readerPollUrl,
				capturePollUrls: state.capturePollUrls,
				related,
				relatedPollUrl,
				...pastReadsOptions,
				currentPath,
				now: deps.now(),
				extensionInstallUrl: undefined,
				backLink: APP_BACK_LINK,
				renderActions: deps.chromelessReader,
				readlistFiling,
				provenance,
				exitConfirmScopes: [EXIT_CONFIRM_SCOPE.nextReadCard],
				readerPathFor: readerPathFor(req),
				markStatusConfirmReadlists: readlistFiling.markStatusConfirmReadlists,
				readerNotice: readerNoticeOf(state.readerView) ?? transcriptNoticeOf(ownedArticle.media),
				epubDownloadHref: epubHrefFor(req, ownedArticle, state.content),
				issueLinks,
				deletion,
				highlights,
			});
			assert(readerBody.scripts, "the reader page always sets its scripts");
			sendComponent(
				req, res,
				settle(
					ChromelessPage(
						{
							...readerBody,
							scripts:
								readerBody.scripts +
								readerMarkReadBridgeScript(cspNonce) +
								readerStatusChangedBridgeScript(cspNonce) +
								(state.readerView.kind !== "not-an-article" ? readerCaptureBridgeScript(cspNonce) : ""),
						},
						{
							changelogBanner: FETCH_CHANGELOG_BANNER_IN_BROWSER,
							// The dismiss form posts this back so the 303 lands on the same
							// article, still carrying `platform=ios` — so the reader returns to
							// the chromeless shell rather than the full web one.
							currentPath,
							cspNonce,
							appearance,
						},
					),
					readerCacheControl,
				),
			);
			return;
		}

		res.vary("Cookie");
		res.vary("User-Agent");

		const showExtensionSuggestionBanner =
			readerContentUnavailable(state.readerView) && canOfferExtensionInstall(req);

		// Owner-only removal controls: which snapshots this owner authored. Only the
		// full-shell owner reader below gets it — never the public /view or the iOS
		// chromeless branch above.
		const authoredVersions =
			state.readerView.kind !== "not-an-article" ? await deps.findArticleCrawlVersions(ownedArticle.url) : [];
		const authoredMinuteIds = authoredVersions
			.filter((version) => version.authorUserId === ownedArticle.userId)
			.map((version) => version.crawledAtMinute);
		const articleHistoryRemoval = {
			authoredMinuteIds,
			removeVersionUrl: withInternalTracking(
				`${READLIST_PATH}/${ownedArticle.id.value}/remove-my-version`,
				{ source: "reader-crawl-bookmark", content: "remove-my-version" },
			),
		};

		sendComponent(
			req, res,
			settle(
				Base(withOfflineReading(ReaderPage(ownedArticle, {
					appOrigin: deps.appOrigin,
					enclosure: ownedEnclosure({ viewer: viewerFor(req.userId), article: ownedArticle }),
					readerSection: ownerReaderSection(req, ownedArticle.id.value),
					content: state.content,
					summary: state.summary,
					summaryPollUrl: state.summaryPollUrl,
					crawl: state.crawl,
					readerPollUrl: state.readerPollUrl,
					capturePollUrls: state.capturePollUrls,
					related,
					relatedPollUrl,
					...pastReadsOptions,
					currentPath,
					now: deps.now(),
					extensionInstallUrl: extensionInstallUrlIfMissing(req),
					backLink: VIEW_BACK_LINK,
					renderActions: deps.webReader,
					readlistFiling,
					provenance,
					markStatusConfirmReadlists: readlistFiling.markStatusConfirmReadlists,
					crawlVersions: state.crawlVersions,
					articleHistoryRemoval,
					offlineCopyRow: true,
					exitConfirmScopes: [
						EXIT_CONFIRM_SCOPE.articleBody,
						EXIT_CONFIRM_SCOPE.nextReadCard,
					],
					readerPathFor: readerPathFor(req),
					readerNotice: readerNoticeOf(state.readerView) ?? transcriptNoticeOf(ownedArticle.media),
					epubDownloadHref: epubHrefFor(req, ownedArticle, state.content),
					epubDownloadGuide: epubGuideFor(req, ownedArticle),
					issueLinks,
					deletion,
					highlights,
					statusToast: options.toast,
				}), cspNonce), {
					...(await deps.buildBannerState(req)),
					currentPath,
					showExtensionSuggestionBanner,
					extensionInstalled: isExtensionInstalled(req),
				}),
				readerCacheControl,
			),
		);
	};

	router.get("/:id/view", noindexMiddleware, (req: Request<{ id: string }>, res: Response) =>
		renderOwnerReader(req, res, { statusCode: 200, toast: undefined, markViewed: true }),
	);

	return { router, renderOwnerReader };
}
