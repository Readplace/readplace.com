import { createHash } from "node:crypto";
import type { SavedArticle } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";

export interface ArticleContentVersionInput {
	article: Pick<SavedArticle, "metadata" | "contentFetchedAt">;
	crawl: ArticleCrawl | undefined;
	summary: GeneratedSummary | undefined;
}

function crawlReasonOf(crawl: ArticleCrawl | undefined): string {
	if (crawl === undefined) return "";
	if (crawl.status === "failed" || crawl.status === "unsupported") return crawl.reason;
	return "";
}

function summaryTextOf(summary: GeneratedSummary | undefined): string {
	if (summary === undefined) return "";
	if (summary.status === "ready") return summary.summary;
	return "";
}

function summaryExcerptOf(summary: GeneratedSummary | undefined): string {
	if (summary === undefined) return "";
	if (summary.status === "ready" && summary.excerpt !== undefined) return summary.excerpt;
	return "";
}

function summaryReasonOf(summary: GeneratedSummary | undefined): string {
	if (summary === undefined) return "";
	if (summary.status === "failed") return summary.reason;
	if (summary.status === "skipped" && summary.reason !== undefined) return summary.reason;
	return "";
}

export function computeArticleContentVersion(input: ArticleContentVersionInput): string {
	const { article, crawl, summary } = input;
	const fields = [
		article.metadata.title,
		article.metadata.excerpt,
		article.metadata.imageUrl === undefined ? "" : article.metadata.imageUrl,
		article.metadata.siteName,
		String(article.metadata.wordCount),
		crawl === undefined ? "" : crawl.status,
		crawlReasonOf(crawl),
		summary === undefined ? "" : summary.status,
		summaryTextOf(summary),
		summaryExcerptOf(summary),
		summaryReasonOf(summary),
		article.contentFetchedAt === undefined ? "" : article.contentFetchedAt.toISOString(),
	];
	const hash = createHash("sha256");
	for (const field of fields) {
		hash.update(field);
		hash.update("|");
	}
	return hash.digest("hex").slice(0, 16);
}
