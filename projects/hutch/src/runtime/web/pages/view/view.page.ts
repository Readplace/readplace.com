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
} from "@packages/test-fixtures/providers/article-store";
import type { ReadArticleContent } from "@packages/test-fixtures/providers/article-store";
import type {
	FindArticleCrawlStatus,
	MarkCrawlPending,
} from "@packages/test-fixtures/providers/article-crawl";
import type {
	FindGeneratedSummary,
	MarkSummaryPending,
} from "@packages/test-fixtures/providers/article-summary";
import type {
	PublishSaveAnonymousLink,
	PublishStaleCheckRequested,
} from "@packages/test-fixtures/providers/events";
import { wantsMarkdown } from "../../content-negotiation";
import { sendConditionalHtml } from "../../conditional-get";
import { htmlToMarkdown } from "../../html-to-markdown";
import { buildMarkdownFrontmatter } from "../../markdown-frontmatter";
import { MarkdownPage } from "../../markdown-page";
import { renderPage } from "../../render-page";
import { sendComponent } from "../../send-component";
import { extensionInstallUrlIfMissing } from "../../onboarding/extension-install";
import { initArticleReader } from "../../shared/article-reader/article-reader";
import type {
	ArticleReaderDeps,
	PollUrlBuilder,
} from "../../shared/article-reader/article-reader.types";
import { collectUtmParams } from "../../shared/utm";
import { SaveErrorPage } from "../save/save-error.component";
import { ViewLandingPage } from "./view-landing.component";
import { ViewPage, formatViewDocumentTitle, type ViewAction } from "./view.component";

interface ViewDependencies {
	validateSaveableUrl: ValidateSaveableUrl;
	findArticleByUrl: FindArticleByUrl;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	markSummaryPending: MarkSummaryPending;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	markCrawlPending: MarkCrawlPending;
	saveArticleGlobally: SaveArticleGlobally;
	publishSaveAnonymousLink: PublishSaveAnonymousLink;
	publishStaleCheckRequested: PublishStaleCheckRequested;
	now: () => Date;
}

function renderError(req: Request, res: Response) {
	const redirectUrl = req.userId ? "/queue" : "/";
	const linkLabel = req.userId ? "Go to your queue" : "Go to homepage";
	sendComponent(req, res, renderPage(req, SaveErrorPage({ redirectUrl, linkLabel })));
}

function hostnameFrom(validatedUrl: string): string {
	return new URL(validatedUrl).hostname;
}

function pollUrlBuilderFor(articleUrl: string): PollUrlBuilder {
	return {
		summary: (n) => `/view/summary?url=${encodeURIComponent(articleUrl)}&poll=${n}`,
		reader: (n) => `/view/reader?url=${encodeURIComponent(articleUrl)}&poll=${n}`,
	};
}

function buildArticleReaderDeps(deps: ViewDependencies): ArticleReaderDeps {
	return {
		findArticleCrawlStatus: deps.findArticleCrawlStatus,
		markCrawlPending: deps.markCrawlPending,
		findGeneratedSummary: deps.findGeneratedSummary,
		markSummaryPending: deps.markSummaryPending,
		readArticleContent: deps.readArticleContent,
		findArticleByUrl: deps.findArticleByUrl,
		formatDocumentTitle: formatViewDocumentTitle,
		now: deps.now,
	};
}

function handleViewLanding(deps: ViewDependencies) {
	return (req: Request, res: Response) => {
		const submittedUrl =
			typeof req.query.url === "string" ? req.query.url : undefined;
		if (submittedUrl === undefined) {
			sendComponent(req, res, renderPage(req, ViewLandingPage()));
			return;
		}
		const validation = deps.validateSaveableUrl(submittedUrl);
		if (validation.status === "ERROR") {
			renderError(req, res);
			return;
		}
		res.redirect(302, `/view/${encodeURIComponent(validation.url)}`);
	};
}

function handleViewArticle(deps: ViewDependencies) {
	const reader = initArticleReader(buildArticleReaderDeps(deps));
	return async (
		req: Request<Record<string, string>>,
		res: Response,
	): Promise<void> => {
		const rawPath = req.params[0];
		// API Gateway v2 HTTP API decodes %2F to / before invoking Lambda, so
		// /view/https%3A%2F%2Fexample.com arrives here as /view/https://example.com.
		// Restore the scheme's second slash if any proxy collapsed it (https:/ → https://).
		const normalizedUrl = rawPath.replace(/^(https?):\/(?!\/)/i, "$1://");
		const validation = deps.validateSaveableUrl(normalizedUrl);
		if (validation.status === "ERROR") {
			renderError(req, res);
			return;
		}
		const articleUrl = validation.url;

		// Freshness/conditional-GET is delegated to the stale-check Lambda so
		// /view never blocks on a remote crawl (Medium-hosted articles can take
		// 5-30s). On first visit we still write a stub synchronously so the page
		// has metadata to render and the existing summary/reader pollers see a row.
		const existing = await deps.findArticleByUrl(articleUrl);
		if (!existing) {
			const hostname = hostnameFrom(articleUrl);
			await deps.saveArticleGlobally({
				url: articleUrl,
				metadata: {
					title: hostname,
					siteName: hostname,
					excerpt: "",
					wordCount: 0,
				},
				estimatedReadTime: calculateReadTime(0),
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

		const utmParams = collectUtmParams(req.query);

		const actions: ViewAction[] = [
			{
				name: "Save to My Queue",
				href: `/save?${new URLSearchParams([["url", articleUrl], ...utmParams]).toString()}`,
				variant: "primary",
			},
			{
				name: "Paste another link",
				href: "/view?utm_source=view-article&utm_medium=internal&utm_content=paste-another-link",
				variant: "secondary",
			},
		];

		sendComponent(
			req, res,
			renderPage(req, ViewPage({
				articleUrl,
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
			})),
		);
	};
}

function handleViewSummary(deps: ViewDependencies) {
	const reader = initArticleReader(buildArticleReaderDeps(deps));
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
		});
		sendConditionalHtml(req, res, component);
	};
}

function handleViewReader(deps: ViewDependencies) {
	const reader = initArticleReader(buildArticleReaderDeps(deps));
	return async (req: Request, res: Response): Promise<void> => {
		const validation = deps.validateSaveableUrl(req.query.url);
		if (validation.status === "ERROR") {
			res.status(400).type("html").send("");
			return;
		}
		const articleUrl = validation.url;
		const pollCount = Number(req.query.poll ?? "0");
		const component = await reader.handleReaderPoll({
			articleUrl,
			pollCount,
			pollUrlBuilder: pollUrlBuilderFor(articleUrl),
			extensionInstallUrl: extensionInstallUrlIfMissing(req),
		});
		sendConditionalHtml(req, res, component);
	};
}

export function initViewRoutes(deps: ViewDependencies): Router {
	const router = express.Router();

	router.get("/", handleViewLanding(deps));
	router.get("/summary", handleViewSummary(deps));
	router.get("/reader", handleViewReader(deps));
	router.get<string, Record<string, string>>("/*", handleViewArticle(deps));

	return router;
}
