import type { ArticleMetadata } from "./article.types";
import type { CanonicalImageUrl } from "./canonical-image-url";
import type { CanonicalPublishedOn } from "./canonical-published-on";

export type CanonicalMetadata = Omit<ArticleMetadata, "imageUrl" | "publishedOn"> & {
	imageUrl: CanonicalImageUrl;
	publishedOn: CanonicalPublishedOn;
};
