import type { ArticleBody } from "@packages/domain/article";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";

export interface ArticleFrontMatter {
	title: string;
	siteName: string;
	excerpt: string;
	summary: GeneratedSummary | undefined;
}

export type BookChapter = ArticleFrontMatter & { articleUrl: string; contentHtml: ArticleBody };
