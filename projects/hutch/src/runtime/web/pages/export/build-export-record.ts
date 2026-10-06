import {
	displayableReadTime,
	type DisplayableReadTime,
	type SavedArticle,
} from "@packages/domain/article";
import type { EngagementState, StarterPack } from "@packages/provider-contracts/engagement-starter";
import type { ReadlistDefinitionData } from "@packages/provider-contracts/article-store";

export interface ExportArticle {
	provenance?: SavedArticle["provenance"];
	suggestionAttribution?: SavedArticle["suggestionAttribution"];
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
		...(article.provenance === undefined ? {} : { provenance: article.provenance }),
		...(article.suggestionAttribution === undefined
			? {}
			: { suggestionAttribution: article.suggestionAttribution }),
	};
}

export interface ExportEnvelope {
	engagement: EngagementState;
	starterPack?: StarterPack;
	readlists: ReadlistDefinitionData[];
	exportedAt: string;
	articleCount: number;
	articles: ExportArticle[];
}
