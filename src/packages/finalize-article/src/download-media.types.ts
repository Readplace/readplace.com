import type { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

export type DownloadedMedia = { originalUrl: string; cdnUrl: string };

export type DownloadMedia = (params: {
	html: string;
	articleUrl: string;
	articleResourceUniqueId: ArticleResourceUniqueId;
}) => Promise<DownloadedMedia[]>;
