import assert from "node:assert";
import type { Request, Response, Router } from "express";
import express from "express";
import type {
	ArticleMetadata,
	Minutes,
} from "@packages/domain/article";
import type { ValidateSaveableUrl } from "@packages/domain/article";
import { calculateReadTime } from "@packages/domain/article";
import type {
	FindArticleByUrl,
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
import { isbot } from "isbot";
import { decomposeTimeLeft } from "@packages/time-left";
import type { HutchLogger } from "@packages/hutch-logger";
import { hashIp, type AnalyticsEvent } from "../../middleware/analytics";
import { rateLimitKeyFromRequest, sendRateLimited } from "../../middleware/rate-limit";
import { ANALYTICS_EVENTS, STREAMS } from "../../../observability/events";
import { articleHostFrom } from "../../../observability/content-source";
import { wantsMarkdown, htmlToMarkdown, buildMarkdownFrontmatter, MarkdownPage, sendComponent } from "@packages/web-shell";
import { CacheableComponent } from "../../conditional-get";

import { Base } from "../../base.component";
import type { BuildBannerState } from "../../banner-state";

import { extensionInstallUrlIfMissing, isExtensionInstalled } from "../../onboarding/extension-install";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type {
	ArticleReaderDeps,
	PollUrlBuilder,
} from "../../shared/article-reader/article-reader.types";
import { isFullyParsed } from "../../shared/article-state/is-fully-parsed";
import { collectUtmParams } from "../../shared/utm";
import { SaveErrorPage } from "../save/save-error.component";
import { ViewLandingPage } from "./view-landing.component";
import type { ExistsUserByIdPrefix } from "@packages/provider-contracts/auth";
import { PERMANENT_ARTICLE_DOMAINS, computePublicViewExpiry, formatSaveUtmContent, sharedUserIdFrom, sharedUserIdFromQueryParams, type ExpiryCountdown } from "./view-expiry";
import { parseViewPath, viewPathFor } from "./view-path";
import { canonicalRedirectTarget } from "../../shared/canonical-redirect";
import { ViewPage, formatViewDocumentTitle, type ViewAction } from "./view.component";

interface ViewDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	appOrigin: string;
	findArticleByUrl: FindArticleByUrl;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	saveArticleGlobally: SaveArticleGlobally;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	consumeRateLimit: ConsumeRateLimit;
	viewCrawlRateLimit: RateLimitRule;
	existsUserByIdPrefix: ExistsUserByIdPrefix;
	expiryCountdown: ExpiryCountdown;
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

/** True when the url's path already ends in "/". Only slash-less paths get the
 * trailing-slash fallback rewrite, which is also what prevents a redirect loop. */
function pathHasTrailingSlash(url: string): boolean {
	return new URL(url).pathname.endsWith("/");
}

/** The same url with a single trailing slash appended to its path (query + hash
 * preserved), so the storage identity matches the origin's "/" canonical. */
function withTrailingSlashPath(url: string): string {
	const u = new URL(url);
	u.pathname = `${u.pathname}/`;
	return u.toString();
}

function buildArticleReaderDeps(deps: ViewDependencies): ArticleReaderDeps {
	return {
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		findGeneratedSummary: deps.findGeneratedSummary,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		appOrigin: deps.appOrigin,
		formatDocumentTitle: formatViewDocumentTitle,
		summaryOpen: true,
		now: deps.now,
	};
}

function handleViewLanding(deps: ViewDependencies) {
	return async (req: Request, res: Response) => {
		const submittedUrl =
			typeof req.query.url === "string" ? req.query.url : undefined;
		if (submittedUrl === undefined) {
			sendComponent(req, res, Base(ViewLandingPage(), await deps.buildBannerState(req)));
			return;
		}
		const validation = deps.validateSaveableUrl(submittedUrl);
		if (validation.status === "ERROR") {
			await renderError(deps, req, res);
			return;
		}
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
		const articleUrl = validation.url;

		// Freshness/conditional-GET is delegated to the stale-check Lambda so
		// /view never blocks on a remote crawl (Medium-hosted articles can take
		// 5-30s). On first visit we still write a stub synchronously so the page
		// has metadata to render and the existing summary/reader pollers see a row.
		const existing = await deps.findArticleByUrl(articleUrl);
		const canonicalTarget = canonicalRedirectTarget({ requestedUrl: articleUrl, article: existing });
		if (canonicalTarget) {
			// This url redirected to a different canonical identity at crawl time;
			// send the reader to the canonical view so it renders that row's real
			// content + metadata instead of the empty alias.
			res.redirect(302, viewPathFor(canonicalTarget));
			return;
		}

		// Trailing-slash content fallback: many origins 308 a slash-less URL to its
		// "/" canonical. When we have no content for the slash-less URL — its origin
		// crawl was edge-blocked (IP/JA3), or it was never fetched — but the "/" one
		// does (e.g. saved via the extension, since the browser lands on the "/"
		// form after the 308), serve the "/" one instead of a blank reader. Only
		// slash-less paths qualify, so this can never loop.
		if (!pathHasTrailingSlash(articleUrl)) {
			const ownContent = await deps.readArticleContent(articleUrl);
			if (!ownContent) {
				const slashUrl = withTrailingSlashPath(articleUrl);
				const slashContent = await deps.readArticleContent(slashUrl);
				if (slashContent) {
					res.redirect(302, viewPathFor(slashUrl));
					return;
				}
			}
		}

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
			const hostname = articleHostFrom(articleUrl);
			await deps.saveArticleGlobally({
				url: articleUrl,
				metadata: {
					title: hostname,
					siteName: hostname,
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: calculateReadTime(0),
				savedAt: deps.now(),
			});
			await deps.markCrawlPending({ url: articleUrl });
			await deps.markSummaryPending({ url: articleUrl });
			await deps.publishSaveAnonymousLink({ url: articleUrl });
		}
		await deps.publishStaleCheckRequested({ url: articleUrl });

		// Re-read metadata after any first-visit save. In production this returns
		// the stub we just wrote (the worker is async); in tests where the
		// in-memory worker fixture runs synchronously inside the awaited dispatch,
		// this picks up the parsed metadata the fixture wrote.
		const articleSnapshot = await deps.findArticleByUrl(articleUrl);
		assert(articleSnapshot, "article row must exist after saveArticleGlobally");
		const metadata: ArticleMetadata = articleSnapshot.metadata;
		const estimatedReadTime: Minutes = articleSnapshot.estimatedReadTime;

		const pollUrlBuilder = pollUrlBuilderFor(articleUrl);
		const state = await reader.resolveReaderState({
			article: { url: articleUrl, metadata, estimatedReadTime },
			pollUrlBuilder,
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

		if (!isbot(req.get("user-agent"))) {
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

		const utmParams = collectUtmParams(req.query);
		const utmContent = typeof req.query.utm_content === "string" ? req.query.utm_content : undefined;
		const now = deps.now();

		let expiresAt: Date | null = null;
		if (deps.expiryCountdown === "enabled" && req.userId === undefined) {
			const sharerPrefix = sharedUserIdFromQueryParams(utmContent);
			const isValidSharer = sharerPrefix !== null && await deps.existsUserByIdPrefix(sharerPrefix);
			const articleDomain = new URL(articleUrl).hostname;
			({ expiresAt } = computePublicViewExpiry({
				savedAt: articleSnapshot.savedAt,
				articleDomain,
				permanentArticleDomains: PERMANENT_ARTICLE_DOMAINS,
				isValidSharer,
			}));
		}

		const saveParams = new URLSearchParams([["url", articleUrl], ...utmParams]);
		const msLeft = expiresAt === null ? null : expiresAt.getTime() - now.getTime();
		const counting = msLeft !== null && msLeft > 0;
		if (counting) saveParams.set("utm_content", formatSaveUtmContent(decomposeTimeLeft(msLeft)));

		const actions: ViewAction[] = [
			{
				name: "Save to My Queue",
				href: `/save?${saveParams.toString()}`,
				variant: "primary",
				expirySaveLink: counting,
			},
			{
				name: "Paste another link",
				href: "/view?utm_source=view-article&utm_medium=internal&utm_content=paste-another-link",
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
					extensionInstallUrl: extensionInstallUrlIfMissing(req),
					expiresAt,
					now,
					sharerUserIdPrefix,
				}),
				{ ...(await deps.buildBannerState(req)), showExtensionSuggestionBanner, extensionInstalled: isExtensionInstalled(req) },
			),
		);
	};
}

function handleViewSummary(deps: ViewDependencies, reader: ReturnType<typeof initArticleReader>) {
	return async (req: Request, res: Response): Promise<void> => {
		const validation = deps.validateSaveableUrl(req.query.url);
		if (validation.status === "ERROR") {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = validation.url;
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleSummaryPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: undefined,
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
		/* c8 ignore next -- V8 block coverage phantom: async continuation after if/return creates zero-count sub-range (bcoe/c8#319, v8.dev/blog/javascript-code-coverage) */
		const articleUrl = validation.url;
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleReaderPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
			summaryToggleUrl: undefined,
		});
		sendComponent(req, res, CacheableComponent(component, req));
	};
}

export function initViewRoutes(deps: ViewDependencies): Router {
	const router = express.Router();
	const reader = initArticleReader(buildArticleReaderDeps(deps));

	router.get("/", handleViewLanding(deps));
	router.get("/summary", handleViewSummary(deps, reader));
	router.get("/reader", handleViewReader(deps, reader));
	router.get<string, { splat: string[] }>("/*splat", handleViewArticle(deps, reader));

	return router;
}
