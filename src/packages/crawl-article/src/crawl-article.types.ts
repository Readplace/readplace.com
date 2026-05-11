export type ThumbnailImage = {
	body: Buffer;
	contentType: string;
	url: string;
	extension: string;
};

export type CrawlArticleResult =
	| {
			status: "fetched";
			html: string;
			thumbnailUrl?: string;
			thumbnailImage?: ThumbnailImage;
			etag?: string;
			lastModified?: string;
	  }
	| { status: "not-modified" }
	| { status: "failed" }
	| { status: "unsupported"; reason: string };

export type CrawlArticle = (params: {
	url: string;
	etag?: string;
	lastModified?: string;
	fetchThumbnail?: boolean;
}) => Promise<CrawlArticleResult>;
