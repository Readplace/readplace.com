import {
	displayableReadTime,
	type DisplayableReadTime,
	type SavedArticle,
} from "@packages/domain/article";

export interface ExportArticle {
	url: string;
	title: string;
	siteName: string;
	excerpt: string;
	wordCount: number;
	readTime: DisplayableReadTime | null;
	status: SavedArticle["status"];
	savedAt: string;
	readAt: string | null;
}

export function toExportArticle(article: SavedArticle): ExportArticle {
	return {
		url: article.url,
		title: article.metadata.title,
		siteName: article.metadata.siteName,
		excerpt: article.metadata.excerpt,
		wordCount: article.metadata.wordCount,
		readTime: displayableReadTime(article) ?? null,
		status: article.status,
		savedAt: article.savedAt.toISOString(),
		readAt: article.readAt?.toISOString() ?? null,
	};
}

export interface ExportEnvelope {
	exportedAt: string;
	articleCount: number;
	articles: ExportArticle[];
}
