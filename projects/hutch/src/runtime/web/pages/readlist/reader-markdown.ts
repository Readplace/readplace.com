import type { NextFunction, Request, Response } from "express";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type ArticleBody, type Highlight, viewerFor } from "@packages/domain/article";
import { readerReadlists, readlistsHoldingArticle } from "@packages/domain/readlist";
import type { ArticleCrawl, FindArticleCrawlStatus } from "@packages/provider-contracts/article-crawl";
import type {
	ListReadlistDefinitions,
	ListUserSavesForUrl,
	ReadArticleContent,
} from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { CanonicalSnapshot, ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { RecordEngagementActivity } from "@packages/provider-contracts/engagement-starter";
import type { ListArticleHighlights } from "@packages/provider-contracts/highlights";
import { MarkdownPage, sendComponent, wantsMarkdown } from "@packages/web-shell";
import type { ResolveOwnedArticle } from "../../mcp/article-lookup";
import type { ReaderHighlightState } from "../../shared/article-body/reader-slot/mark-highlights";
import { prepareReaderContent, WHOLE_DOCUMENT_SECTION } from "../../shared/article-body/reader-slot/reader-content";
import { articleMarkdown } from "../../shared/article-markdown/article-markdown";
import { highlightsMarkdown } from "../../shared/article-markdown/highlights-markdown";

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
	listArticleHighlights: ListArticleHighlights;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
}

function storedHighlightStates(rows: readonly Highlight[]): readonly ReaderHighlightState[] {
	return rows.map((highlight) => ({
		highlight,
		anchor: { start: highlight.start, end: highlight.end, anchorState: highlight.anchorState },
	}));
}

function markdownHighlightStates(input: {
	url: string;
	appOrigin: string;
	rows: readonly Highlight[];
	content: ArticleBody | undefined;
	crawl: ArticleCrawl | undefined;
	snapshot: CanonicalSnapshot | undefined;
}): readonly ReaderHighlightState[] {
	const { content, crawl } = input;
	if (input.rows.length === 0 || content === undefined || (crawl !== undefined && crawl.status !== "ready")) {
		return storedHighlightStates(input.rows);
	}
	return prepareReaderContent({
		content,
		appOrigin: input.appOrigin,
		url: input.url,
		section: WHOLE_DOCUMENT_SECTION,
		highlights: { rows: input.rows, canonicalContentHash: input.snapshot?.canonicalContentHash },
	}).states;
}

export function isDeliberateReaderRequest(req: Request): boolean {
	return (
		req.query.poll === undefined &&
		req.get("X-Purpose") !== "preview" &&
		!req.get("Purpose")?.includes("prefetch") &&
		!req.get("Sec-Purpose")?.includes("prefetch") &&
		!req.get("Authorization")?.startsWith("Bearer ")
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
		const [crawl, summary, stored, definitions, saves, highlightRows, snapshot] = await Promise.all([
			deps.findArticleCrawlStatus(article.url),
			deps.findGeneratedSummary({ url: article.url, viewer: viewerFor(userId) }),
			deps.readArticleContent({ url: article.url, viewer: viewerFor(userId) }),
			deps.listReadlistDefinitions(userId),
			deps.listUserSavesForUrl({ userId, url: article.url }),
			deps.listArticleHighlights({ userId, url: ArticleResourceUniqueId.parse(article.url).value }),
			deps.readCanonicalSnapshot(article.url),
		]);
		const content = stored.kind === "article" ? stored.body : undefined;
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
				}) +
					highlightsMarkdown(
						markdownHighlightStates({
							url: article.url,
							appOrigin: deps.appOrigin,
							rows: highlightRows,
							content,
							crawl,
							snapshot,
						}),
					),
			),
		);
	};
}
