import type { ArticleBody } from "@packages/domain/article";
import type { GeneratedSummary } from "@packages/provider-contracts/article-summary";
import type { BookChapter } from "./book-chapter.types";

export function bookChapterOf(input: {
	article: { url: string; metadata: { title: string; siteName: string; excerpt: string } };
	summary: GeneratedSummary | undefined;
	contentHtml: ArticleBody;
}): BookChapter {
	return {
		articleUrl: input.article.url,
		title: input.article.metadata.title,
		siteName: input.article.metadata.siteName,
		excerpt: input.article.metadata.excerpt,
		summary: input.summary,
		contentHtml: input.contentHtml,
	};
}
