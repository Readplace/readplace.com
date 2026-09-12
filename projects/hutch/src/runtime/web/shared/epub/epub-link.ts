import { viewPathFor } from "../../pages/view/view-path";

export function articleEpubHref(params: { articleUrl: string; utmSource: string }): string {
	const query = new URLSearchParams([
		["format", "epub"],
		["utm_source", params.utmSource],
		["utm_medium", "internal"],
		["utm_content", "download-epub"],
	]);
	return `${viewPathFor(params.articleUrl)}?${query.toString()}`;
}
