import { articleFromHostTitle, savedFromHostExcerpt } from "./article-site";
import type { ArticleMetadata } from "./article.types";

export function stubMetadataFor(
	hostname: string,
): Pick<ArticleMetadata, "title" | "siteName" | "excerpt"> {
	return {
		title: articleFromHostTitle(hostname),
		siteName: hostname,
		excerpt: savedFromHostExcerpt(hostname),
	};
}
