import type { NextFunction, Request, Response } from "express";
import { readerReadlists, readlistsHoldingArticle } from "@packages/domain/readlist";
import type { FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type {
	ListReadlistDefinitions,
	ListUserSavesForUrl,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import { MarkdownPage, sendComponent, wantsMarkdown } from "@packages/web-shell";
import type { ResolveOwnedArticle } from "../../mcp/article-lookup";
import { articleMarkdown } from "../../shared/article-markdown/article-markdown";

interface OwnerArticleMarkdownDeps {
	recordEngagementActivity: RecordEngagementActivity;
	now: () => Date;
	appOrigin: string;
	resolveOwnedArticle: ResolveOwnedArticle;
	findArticleCrawlStatus: FindArticleCrawlStatus;
	findGeneratedSummary: FindGeneratedSummary;
	readArticleContent: ReadArticleContent;
	listReadlistDefinitions: ListReadlistDefinitions;
	listUserSavesForUrl: ListUserSavesForUrl;
}

export function isDeliberateReaderRequest(req: Request): boolean {
	return (
		req.query.poll === undefined &&
		req.get("X-Purpose") !== "preview" &&
		!req.get("Purpose")?.includes("prefetch") &&
		!req.get("Sec-Purpose")?.includes("prefetch")
	);
}

export function initOwnerArticleMarkdown(deps: OwnerArticleMarkdownDeps) {
	return async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
		const { userId } = req;
		if (!wantsMarkdown(req) || userId === undefined) {
			next();
			return;
		}

		const owned = await deps.resolveOwnedArticle({ userId, id: req.params.id });
		if (owned === null) {
			if (!req.headers.authorization?.startsWith("Bearer ")) {
				next();
				return;
			}
			res.set("Cache-Control", "private, no-cache");
			sendComponent(req, res, MarkdownPage("# Not found\n", 404));
			return;
		}

		const { article, readlist } = owned;
		const [crawl, summary, content, definitions, saves] = await Promise.all([
			deps.findArticleCrawlStatus(article.url),
			deps.findGeneratedSummary(article.url),
			deps.readArticleContent(article.url),
			deps.listReadlistDefinitions(userId),
			deps.listUserSavesForUrl({ userId, url: article.url }),
		]);
		const readlists = readlistsHoldingArticle({
			saves,
			readlists: readerReadlists(definitions),
		});
		if (isDeliberateReaderRequest(req))
			await deps.recordEngagementActivity({
				userId,
				kind: "reader-open",
				articleId: article.id,
				campaignId: article.suggestionAttribution?.campaignId,
				at: deps.now(),
			});

		res.set("Cache-Control", "private, no-cache");
		sendComponent(
			req,
			res,
			MarkdownPage(
				articleMarkdown({
					article,
					readlist,
					readlists,
					appOrigin: deps.appOrigin,
					crawl,
					content,
					summary,
				}),
			),
		);
	};
}
