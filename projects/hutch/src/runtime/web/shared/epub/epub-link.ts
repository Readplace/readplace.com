import type { SaveClient } from "@packages/web-analytics";
import { withInternalTracking } from "@packages/web-shell";
import { highlightActionUrl } from "../../pages/readlist/highlight-surface";
import { READLIST_PATH } from "../../pages/readlist/readlist.url";
import { viewPathFor } from "../../pages/view/view-path";

export const EPUB_DOWNLOAD_CONTENT = "download-epub";

export function articleEpubHref(params: {
	articleUrl: string;
	utmSource: string;
	appClient: SaveClient | undefined;
}): string {
	return withInternalTracking(`${viewPathFor(params.articleUrl)}?format=epub`, {
		source: params.utmSource,
		content: EPUB_DOWNLOAD_CONTENT,
		term: params.appClient,
	});
}

export function ownerArticleEpubHref(params: {
	articleId: string;
	appClient: SaveClient | undefined;
}): string {
	const path = highlightActionUrl({
		path: `${READLIST_PATH}/${params.articleId}/view`,
		readlist: [],
		surface: [["format", "epub"]],
		enabled: true,
	});
	return withInternalTracking(path, {
		source: "reader",
		content: EPUB_DOWNLOAD_CONTENT,
		term: params.appClient,
	});
}
