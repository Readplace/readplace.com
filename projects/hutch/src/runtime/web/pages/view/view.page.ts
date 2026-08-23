import assert from "node:assert";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import { calculateReadTime } from "@packages/domain/article";
import type {
	FindArticleByUrl,
	FindArticleCrawlVersions,
	FindArticleFreshness,
	SaveArticleGlobally,
} from "@packages/provider-contracts/article-store";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type {
	FindArticleCrawlStatus,
	MarkCrawlPending,
} from "@packages/provider-contracts/article-crawl";
import type {
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/provider-contracts/article-summary";
import type {
	PublishSaveAnonymousLink,
	PublishStaleCheckRequested,
} from "@packages/provider-contracts/events";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import { decomposeTimeLeft } from "@packages/time-left";
import type { HutchLogger } from "@packages/hutch-logger";
import { articleHostFrom, hashIp, isBotUserAgent, isCountableBrowserRequest, type AnalyticsEvent } from "@packages/web-analytics";
import { rateLimitKeyFromRequest, sendRateLimited } from "../../middleware/rate-limit";
import { ANALYTICS_EVENTS, SAVE_SURFACE_QUERY, SAVE_SURFACES, STREAMS } from "../../../observability/events";
import { wantsMarkdown, htmlToMarkdown, buildMarkdownFrontmatter, MarkdownPage, sendComponent } from "@packages/web-shell";
import { CacheableComponent } from "../../conditional-get";

import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";

import { extensionInstallUrlIfMissing, isExtensionInstalled } from "../../onboarding/extension-install";
import { setLastViewUrl } from "../../last-view";
import { buildSaveTip } from "../../shared/save-tip/save-tip.component";
import { markSaveTipSeen } from "../../shared/save-tip/save-tip";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type {
	ArticleReaderDeps,
	PollUrlBuilder,
} from "../../shared/article-reader/article-reader.types";
import { isFullyParsed } from "../../shared/article-state/is-fully-parsed";
import { collectUtmParams } from "../../shared/utm";
import { SaveErrorPage } from "../save/save-error.component";
import { NotFoundPage } from "../not-found";
import type { FindUserIdsByPrefix } from "@packages/provider-contracts/auth";
import type { GetEffectiveAccess } from "@packages/subscription-access";
import { resolveSharerPublicAccess } from "./sharer-access";
import { PERMANENT_ARTICLE_DOMAINS, PERMANENT_REFERRER_DOMAINS, computePublicViewExpiry, isPermanentReferrer, formatSaveUtmContent, sharedUserIdFrom, sharedUserIdFromQueryParams } from "./view-expiry";
import { parseViewPath, viewPathFor } from "./view-path";
import { ViewPage, formatViewDocumentTitle, type ViewAction } from "./view.component";

interface ViewDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	ownHost: string;
	secureCookies: boolean;
	findArticleByUrl: FindArticleByUrl;
	findArticleFreshness: FindArticleFreshness;
	findArticleCrawlVersions: FindArticleCrawlVersions;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	saveArticleGlobally: SaveArticleGlobally;
	resolveCanonicalIdentity: (url: string) => Promise<string>;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	consumeRateLimit: ConsumeRateLimit;
	viewCrawlRateLimit: RateLimitRule;
	findUserIdsByPrefix: FindUserIdsByPrefix;
	getEffectiveAccess: GetEffectiveAccess;
	now: () => Date;
	buildBannerState: BuildBannerState;
	analytics: HutchLogger.Typed<AnalyticsEvent>;
	salt: string;
}

async function renderError(deps: ViewDependencies, req: Request, res: Response): Promise<void> {
	const redirectUrl = req.userId ? "/queue" : "/";
	const linkLabel = req.userId ? "Go to your queue" : "Go to homepage";
	sendComponent(req, res, Base(SaveErrorPage({ redirectUrl, linkLabel }), await deps.buildBannerState(req)));
}

function pollUrlBuilderFor(articleUrl: string): PollUrlBuilder {
	return {
		summary: (n) => `/view/summary?url=${encodeURIComponent(articleUrl)}&poll=${n}`,
		reader: (n) => `/view/reader?url=${encodeURIComponent(articleUrl)}&poll=${n}`,
	};
}

/** A browser prefetch (`Sec-Purpose: prefetch`, its `prefetch;prerender` form,
 * or the legacy `Purpose: prefetch`) is not a reader deciding to open the
 * article, so it must not spend /view's first-visit crawl budget. `String(...)`
 * (not `?.`) folds the absent-header case into a plain `false` without a
 * nullish branch the coverage gate can't reach. */
function isPrefetch(req: Request): boolean {
	if (String(req.get("sec-purpose")).includes("prefetch")) return true;
	return String(req.get("purpose")).includes("prefetch");
}

function isPrefetchOrBot(req: Request): boolean {
	if (isPrefetch(req)) return true;
	return isBotUserAgent(req.get("user-agent"));
}

function buildArticleReaderDeps(deps: ViewDependencies): ArticleReaderDeps {
	return {
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		findArticleFreshness: deps.findArticleFreshness,
		findArticleCrawlVersions: deps.findArticleCrawlVersions,
		appOrigin: deps.appOrigin,
		formatDocumentTitle: formatViewDocumentTitle,
		summaryOpen: true,
		now: deps.now,
	};
}

/** `/view` normalises `?url=` (the homepage form and the backstory link) to the
 * canonical `/view/<url>` permalink. A bare hit is a 404: the paste-a-link
 * surface lives on the homepage now, so `/view` on its own names no page. */
function handleViewRoot(deps: ViewDependencies) {
	return async (req: Request, res: Response) => {
		const submittedUrl =
			typeof req.query.url === "string" ? req.query.url : undefined;
		if (submittedUrl === undefined) {
			sendComponent(req, res, Base(NotFoundPage(), await deps.buildBannerState(req)));
			return;
		}
		const validation = deps.validateSaveableUrl(submittedUrl);
		if (validation.status === "ERROR") {
			await renderError(deps, req, res);
			return;
		}
		// Only this route, never the canonical article path: a shared /view link
		// must not spend the session's one warning on a reader who never saw it.
		markSaveTipSeen(res, { secureCookies: deps.secureCookies });
		res.redirect(302, viewPathFor(validation.url));
	};
}

function handleViewArticle(deps: ViewDependencies, reader: ReturnType<typeof initArticleReader>) {
	return async (
		req: Request<{ splat: string[] }>,
		res: Response,
	): Promise<void> => {
		const queryIndex = req.originalUrl.indexOf("?");
		const originalPath = queryIndex === -1 ? req.originalUrl : req.originalUrl.slice(0, queryIndex);
		const encodedPath = originalPath.slice("/view/".length);
		const parsed = parseViewPath({ rawPath: req.params.splat.join("/"), encodedPath });
		if (parsed.kind === "redirect") {
			const queryString = queryIndex === -1 ? "" : req.originalUrl.slice(queryIndex);
			res.redirect(301, `${parsed.canonicalPath}${queryString}`);
			return;
		}
		const validation = deps.validateSaveableUrl(parsed.articleUrl);
		if (validation.status === "ERROR") {
			await renderError(deps, req, res);
			return;
		}
		// Collapse an adopted terminal URL onto the article it aliases before any
		// read/write, so viewing the terminal shows the deduped article and never
		// mints a real row on top of the inert alias marker. The poll links below
		// are built from this resolved URL, so the poll handlers need no resolve.
		const articleUrl = await deps.resolveCanonicalIdentity(validation.url);

		// Freshness/conditional-GET is delegated to the stale-check Lambda so
		// /view never blocks on a remote crawl (Medium-hosted articles can take
		// 5-30s). On first visit we still write a stub synchronously so the page
		// has metadata to render and the existing summary/reader pollers see a row.
		const existing = await deps.findArticleByUrl(articleUrl);
		// A purged (tombstoned) URL is gone: 404 above the first-visit save cascade
		// (so a visit can't re-stub it) and above the wantsMarkdown branch (so the
		// markdown surface 404s too). Metadata/OG never render because we return here.
		if (existing?.purgedAt) {
			sendComponent(req, res, Base(NotFoundPage(), await deps.buildBannerState(req)));
			return;
		}
		const hostname = articleHostFrom(articleUrl);
		const stubMetadata: ArticleMetadata = { title: hostname, siteName: hostname, excerpt: "", wordCount: 0 };
		const stubReadTime = calculateReadTime(0);
		// A prefetch gets the rendered page (stub metadata below) but triggers
		// none of the paid crawl work: a speculative fetch is not a reader asking
		// to spend budget. Bots are deliberately NOT excluded — a third-party
		// importer fetching a /view link must be able to materialise the article
		// it came for. The per-IP budget below caps the first-visit cascade; a
		// repeat visit only publishes a stale check, which the stale-check
		// handler TTL-bounds per article.
		if (!isPrefetch(req)) {
			if (!existing) {
				// First visit is the request that triggers the whole crawl cascade
				// (stub save → crawl → summary → possibly OCR), each leg with real
				// third-party cost — so the per-IP budget is spent here, not on reads
				// of already-known articles.
				const decision = await deps.consumeRateLimit({
					bucket: "view-crawl",
					key: rateLimitKeyFromRequest(req),
					rule: deps.viewCrawlRateLimit,
				});
				if (!decision.allowed) {
					sendRateLimited(res, decision.retryAfterSeconds);
					return;
				}
				await deps.saveArticleGlobally({
					url: articleUrl,
					metadata: stubMetadata,
					estimatedReadTime: stubReadTime,
					savedAt: deps.now(),
				});
				await deps.markCrawlPending({ url: articleUrl });
				await deps.markSummaryPending({ url: articleUrl });
				await deps.publishSaveAnonymousLink({ url: articleUrl });
			}
			await deps.publishStaleCheckRequested({ url: articleUrl });
		}

		// Re-read metadata after any first-visit save. In production this returns
		// the stub we just wrote (the worker is async); in tests where the
		// in-memory worker fixture runs synchronously inside the awaited dispatch,
		// this picks up the parsed metadata the fixture wrote. A just-written stub
		// is not always visible on the immediately-following read (DynamoDB is
		// eventually consistent), so a transient miss renders the row we already
		// had or the stub we just wrote — pending, never a 500.
		const articleSnapshot = await deps.findArticleByUrl(articleUrl);
		const pendingSnapshot: { metadata: ArticleMetadata; estimatedReadTime: Minutes; savedAt: Date } =
			existing ?? { metadata: stubMetadata, estimatedReadTime: stubReadTime, savedAt: deps.now() };
		const snapshot = articleSnapshot ?? pendingSnapshot;
		const metadata: ArticleMetadata = snapshot.metadata;
		const estimatedReadTime: Minutes = snapshot.estimatedReadTime;

		const pollUrlBuilder = pollUrlBuilderFor(articleUrl);
		const state = await reader.resolveReaderState({
			article: { url: articleUrl, metadata, estimatedReadTime },
			pollUrlBuilder,
			capturing: false,
		});

		if (wantsMarkdown(req)) {
			const frontmatter = buildMarkdownFrontmatter({
				title: metadata.title,
				description: metadata.excerpt,
				canonicalUrl: articleUrl,
			});
			const articleMarkdown = state.content ? htmlToMarkdown(state.content) : "";
			sendComponent(req, res, MarkdownPage(`${frontmatter}\n\n${articleMarkdown}`));
			return;
		}

		if (isCountableBrowserRequest({ req, ownHost: deps.ownHost })) {
			assert(req.visitorId, "visitor-id middleware must run before the /view router");
			deps.analytics.info({
				stream: STREAMS.analytics,
				event: ANALYTICS_EVENTS.viewOpened,
				timestamp: deps.now().toISOString(),
				path: originalPath,
				article_host: articleHostFrom(articleUrl),
				visitor_hash: hashIp({ ip: req.ip, salt: deps.salt }),
				visitor_id: req.visitorId,
				is_authenticated: req.userId ? 1 : 0,
			});
		}
		// Deliberately outside the analytics gate: hutch_lastview is the only input
		// to the post-signup first-article autosave, so a reader whose headers the
		// analytics gate rejects must still get the cookie or they sign up and land
		// on an empty queue.
		if (req.userId === undefined && !isPrefetchOrBot(req)) {
			setLastViewUrl({ res, secure: deps.secureCookies }, articleUrl);
		}

		const utmParams = collectUtmParams(req.query);
		const utmContent = typeof req.query.utm_content === "string" ? req.query.utm_content : undefined;
		const now = deps.now();

		let expiresAt: Date | null = null;
		let sharerInactive = false;
		if (req.userId === undefined) {
			const sharerPrefix = sharedUserIdFromQueryParams(utmContent);
			const sharerAccess = sharerPrefix === null
				? "unknown"
				: await resolveSharerPublicAccess(
						{
							findUserIdsByPrefix: deps.findUserIdsByPrefix,
							getEffectiveAccess: deps.getEffectiveAccess,
						},
						sharerPrefix,
					);
			// A sharer whose subscription lapsed keeps no perk — the link expires
			// on the normal schedule — but the paywall says why, which a link that
			// never named a sharer cannot.
			sharerInactive = sharerAccess === "inactive";
			const articleDomain = new URL(articleUrl).hostname;
			({ expiresAt } = computePublicViewExpiry({
				savedAt: snapshot.savedAt,
				articleDomain,
				permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
				isValidSharer: sharerAccess === "valid",
				isPermanentReferrer: isPermanentReferrer({
					referrer: req.get("referer"),
					permanentReferrerDomains: PERMANENT_REFERRER_DOMAINS,
				}),
				estimatedReadTime,
			}));
		}

		const saveParams = new URLSearchParams([["url", articleUrl], ...utmParams]);
		saveParams.set(SAVE_SURFACE_QUERY, SAVE_SURFACES.readerView);
		const msLeft = expiresAt === null ? null : expiresAt.getTime() - now.getTime();
		const counting = msLeft !== null && msLeft > 0;
		if (counting) saveParams.set("utm_content", formatSaveUtmContent(decomposeTimeLeft(msLeft)));

		const saveTip = buildSaveTip(req, { kind: "article", mode: "gating" });
		const actions: ViewAction[] = [
			{
				name: "Save to My Queue",
				href: `/save?${saveParams.toString()}`,
				variant: "primary",
				expirySaveLink: counting,
				saveTipState: saveTip.state,
			},
			{
				name: "Paste another link",
				href: "/?utm_source=view-article&utm_medium=internal&utm_content=paste-another-link",
				variant: "secondary",
			},
		];

		const showExtensionSuggestionBanner = !isFullyParsed({
			crawlStatus: state.crawl?.status,
			summaryStatus: state.summary?.status,
		});

		const sharerUserIdPrefix = req.userId ? sharedUserIdFrom(req.userId) : undefined;

		sendComponent(
			req, res,
			Base(
				ViewPage({
					articleUrl,
					displayUrl: articleSnapshot?.displayUrl,
					appOrigin: deps.appOrigin,
					metadata,
					estimatedReadTime,
					content: state.content,
					crawl: state.crawl,
					readerPollUrl: state.readerPollUrl,
					summary: state.summary,
					summaryPollUrl: state.summaryPollUrl,
					progress: state.progress,
					actions,
					saveTip,
					extensionInstallUrl: extensionInstallUrlIfMissing(req),
					expiresAt,
					now,
					sharerInactive,
					sharerUserIdPrefix,
					crawlVersions: state.crawlVersions,
				}),
				{ ...(await deps.buildBannerState(req)), showExtensionSuggestionBanner, extensionInstalled: isExtensionInstalled(req) },
			),
		);
	};
}

async function isPurged(deps: ViewDependencies, articleUrl: string): Promise<boolean> {
	const article = await deps.findArticleByUrl(articleUrl);
	return article?.purgedAt !== undefined;
}

function handleViewSummary(deps: ViewDependencies, reader: ReturnType<typeof initArticleReader>) {
	return async (req: Request, res: Response): Promise<void> => {
		const validation = deps.validateSaveableUrl(req.query.url);
		if (validation.status === "ERROR") {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = await deps.resolveCanonicalIdentity(validation.url);
		// Stop the htmx summary poll chain once the URL is purged.
		if (await isPurged(deps, articleUrl)) {
			res.status(404).type("html").send("");
			return;
		}
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleSummaryPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			capturing: false,
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: undefined,
			provenance: undefined,
		});
		sendComponent(req, res, CacheableComponent(component, req));
	};
}

function handleViewReader(deps: ViewDependencies, reader: ReturnType<typeof initArticleReader>) {
	return async (req: Request, res: Response): Promise<void> => {
		const validation = deps.validateSaveableUrl(req.query.url);
		if (validation.status === "ERROR") {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = await deps.resolveCanonicalIdentity(validation.url);
		// Stop the htmx reader poll chain once the URL is purged.
		if (await isPurged(deps, articleUrl)) {
			res.status(404).type("html").send("");
			return;
		}
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleReaderPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			capturing: false,
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: undefined,
			provenance: undefined,
		});
		sendComponent(req, res, CacheableComponent(component, req));
	};
}

function redirectMixedCaseMount(req: Request, res: Response, next: NextFunction): void {
	const lowercaseMount = req.baseUrl.toLowerCase();
	if (req.baseUrl === lowercaseMount) {
		next();
		return;
	}
	res.redirect(301, `${lowercaseMount}${req.url}`);
}

export function initViewRoutes(deps: ViewDependencies): Router {
	const router = express.Router();
	const reader = initArticleReader(buildArticleReaderDeps(deps));

	router.use(redirectMixedCaseMount);

	router.get("/", handleViewRoot(deps));
	router.get("/summary", handleViewSummary(deps, reader));
	router.get("/reader", handleViewReader(deps, reader));
	router.get<string, { splat: string[] }>("/*splat", handleViewArticle(deps, reader));

	return router;
}
