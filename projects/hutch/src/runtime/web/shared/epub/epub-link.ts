import { viewPathFor } from "../../pages/view/view-path";

export function revealsEpubDownload(featureQuery: unknown): boolean {
	return featureQuery === "epub";
}

export const ARTICLE_DOWNLOAD_FORMATS = ["epub", "azw3"] as const;

export type ArticleDownloadFormat = (typeof ARTICLE_DOWNLOAD_FORMATS)[number];

export interface ArticleDownloadLinks {
	epubHref: string;
	azw3Href: string;
}

function articleDownloadHref(params: {
	articleUrl: string;
	utmSource: string;
	format: ArticleDownloadFormat;
}): string {
	const query = new URLSearchParams([
		["format", params.format],
		["utm_source", params.utmSource],
		["utm_medium", "internal"],
		["utm_content", `download-${params.format}`],
	]);
	return `${viewPathFor(params.articleUrl)}?${query.toString()}`;
}

export function articleDownloadLinks(params: {
	articleUrl: string;
	utmSource: string;
}): ArticleDownloadLinks {
	return {
		epubHref: articleDownloadHref({ ...params, format: "epub" }),
		azw3Href: articleDownloadHref({ ...params, format: "azw3" }),
	};
}
