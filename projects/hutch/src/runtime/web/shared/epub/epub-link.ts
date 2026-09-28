import type { SaveClient } from "@packages/web-analytics";
import { withInternalTracking } from "@packages/web-shell";
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
