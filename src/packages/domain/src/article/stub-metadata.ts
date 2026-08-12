import type { ArticleMetadata } from "./article.types";

export function stubMetadataFor(
	hostname: string,
): Pick<ArticleMetadata, "title" | "siteName" | "excerpt"> {
	return {
		title: `Article from ${hostname}`,
		siteName: hostname,
		excerpt: `Saved from ${hostname}.`,
	};
}
