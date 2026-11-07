import { createHash } from "node:crypto";
import type { Highlight, SavedArticle, ServedBody } from "@packages/domain/article";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";

export interface ArticleContentVersionInput {
	article: Pick<SavedArticle, "metadata" | "contentFetchedAt" | "servedBody">;
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

function servedBodyFields(servedBody: ServedBody): string[] {
	if (servedBody.kind === "legacy") return [];
	if (servedBody.kind === "withheld") return ["withheld"];
	return [servedBody.location];
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
		...servedBodyFields(article.servedBody),
	];
	const hash = createHash("sha256");
	for (const field of fields) {
		hash.update(field);
		hash.update("|");
	}
	return hash.digest("hex").slice(0, 16);
}

export function withHighlightsVersion(params: {
	contentVersion: string;
	highlights: readonly Pick<Highlight, "highlightId" | "updatedAt" | "anchorRevision" | "anchorState">[];
}): string {
	if (params.highlights.length === 0) return params.contentVersion;
	const hash = createHash("sha256");
	hash.update(params.contentVersion);
	hash.update("|");
	const sorted = [...params.highlights].sort((a, b) => a.highlightId.localeCompare(b.highlightId));
	for (const highlight of sorted) {
		for (const field of [
			highlight.highlightId,
			highlight.updatedAt.toISOString(),
			String(highlight.anchorRevision),
			highlight.anchorState,
		]) {
			hash.update(field);
			hash.update("|");
		}
	}
	return hash.digest("hex").slice(0, 16);
}
