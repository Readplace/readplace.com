import type { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

import type { MediaWriteContext } from "./put-image-object.types";

export type DownloadedMedia = { originalUrl: string; cdnUrl: string };

export type DownloadMedia = (params: {
	html: string;
	referer: string;
	articleResourceUniqueId: ArticleResourceUniqueId;
	writeContext?: MediaWriteContext;
}) => Promise<DownloadedMedia[]>;
