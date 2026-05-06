import type { SavedArticle } from "@packages/domain/article";

export interface ExportArticle {
	url: string;
	title: string;
	siteName: string;
	excerpt: string;
	wordCount: number;
	estimatedReadTimeMinutes: number;
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
		estimatedReadTimeMinutes: article.estimatedReadTime,
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
