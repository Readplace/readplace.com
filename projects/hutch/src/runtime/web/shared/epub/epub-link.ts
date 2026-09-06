import { viewPathFor } from "../../pages/view/view-path";

export const EPUB_FEATURE_QUERY = { name: "feature", value: "epub" } as const;

export function revealsEpubDownload(featureQuery: unknown): boolean {
	return featureQuery === EPUB_FEATURE_QUERY.value;
}

export function epubDownloadHref(params: { articleUrl: string; utmSource: string }): string {
	const query = new URLSearchParams([
		["format", "epub"],
		["utm_source", params.utmSource],
		["utm_medium", "internal"],
		["utm_content", "download-epub"],
	]);
	return `${viewPathFor(params.articleUrl)}?${query.toString()}`;
}
