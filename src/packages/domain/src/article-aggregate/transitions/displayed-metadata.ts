import type { Article, ArticleMetadata } from "../article.types";

type ShownMetadata = Pick<ArticleMetadata, "title" | "siteName" | "excerpt">;

export type MetadataDisplay = { kind: "candidate" } | { kind: "row" } | { kind: "fresh"; shown: ShownMetadata };

export function shownMetadataOf(metadata: ShownMetadata): ShownMetadata {
	return { title: metadata.title, siteName: metadata.siteName, excerpt: metadata.excerpt };
}

export function displayedMetadata<M extends ArticleMetadata>(params: { article: Article; metadata: M; display: MetadataDisplay }): M {
	if (params.display.kind === "candidate") return params.metadata;
	const shown = params.display.kind === "fresh" ? params.display.shown : params.article.metadata;
	return { ...params.metadata, ...shownMetadataOf(shown) };
}
