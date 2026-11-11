import type { NextFunction, Request, Response } from "express";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { offersEpubDownload, viewerFor } from "@packages/domain/article";
import { parseEmailIssueArticleUrl } from "@packages/domain/inbox";
import type { ReadArticleContent } from "@packages/provider-contracts/article-store";
import type { FindGeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import type { ListArticleHighlights } from "@packages/provider-contracts/highlights";
import type { ResolveOwnedArticle } from "../../mcp/article-lookup";
import { type BuildArticleEpub, epubFilename } from "../../shared/epub/article-epub";
import { isPrefetchRequest } from "../../shared/prefetch-request";

interface OwnerArticleEpubDeps {
	appOrigin: string;
	resolveOwnedArticle: ResolveOwnedArticle;
	readArticleContent: ReadArticleContent;
	findGeneratedSummary: FindGeneratedSummary;
	listArticleHighlights: ListArticleHighlights;
	readCanonicalSnapshot: ReadCanonicalSnapshot;
	buildArticleEpub: BuildArticleEpub;
}

export function initOwnerArticleEpub(deps: OwnerArticleEpubDeps) {
	return async (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
		const { userId } = req;
		if (req.query.format !== "epub" || userId === undefined) {
			next();
			return;
		}
		if (isPrefetchRequest(req)) {
			res.status(204).end();
			return;
		}

		const owned = await deps.resolveOwnedArticle({ userId, id: req.params.id });
		if (
			owned === null ||
			parseEmailIssueArticleUrl(owned.article.url) !== undefined ||
			!offersEpubDownload(owned.article)
		) {
			next();
			return;
		}

		const { article } = owned;
		const stored = await deps.readArticleContent({ url: article.url, viewer: viewerFor(userId) });
		if (stored.kind !== "article") {
			next();
			return;
		}

		const [summary, rows, snapshot] = await Promise.all([
			deps.findGeneratedSummary({ url: article.url, viewer: viewerFor(userId) }),
			deps.listArticleHighlights({ userId, url: ArticleResourceUniqueId.parse(article.url).value }),
			deps.readCanonicalSnapshot(article.url),
		]);
		const { title, siteName, excerpt } = article.metadata;
		const build = await deps.buildArticleEpub({
			articleUrl: article.url,
			title,
			siteName,
			excerpt,
			summary,
			contentHtml: stored.body,
			highlighted: {
				highlights: { rows, canonicalContentHash: snapshot?.canonicalContentHash },
				appOrigin: deps.appOrigin,
			},
		});
		res
			.status(200)
			.set({
				"Content-Type": "application/epub+zip",
				"Content-Disposition": `attachment; filename="${epubFilename({ title, destinationUrl: article.destinationUrl })}"`,
				"Cache-Control": "private, no-cache",
				"X-Robots-Tag": "noindex",
				"Content-Signal": "search=no, ai-input=no, ai-train=no",
			})
			.send(Buffer.from(build.bytes));
	};
}
