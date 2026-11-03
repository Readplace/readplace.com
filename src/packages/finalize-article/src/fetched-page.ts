import { resolveDocumentUrl, type ThumbnailCascade } from "@packages/crawl-article";
import type { FinalizeArticle } from "./finalize-article";
import type { MediaWriteContext } from "./put-image-object.types";

export type FetchedPage = { html: string; finalUrl?: string; thumbnail?: ThumbnailCascade } & (
	| { mediaType?: "image" }
	| { mediaType: "plain-text"; plainText: string }
);

export function finalizeInputOfFetchedPage(params: {
	savedUrl: string;
	requestedUrl: string;
	writeContext?: MediaWriteContext;
	fetched: FetchedPage;
}): Parameters<FinalizeArticle>[0] {
	const { fetched } = params;
	return {
		writeContext: params.writeContext,
		url: params.savedUrl,
		documentUrl: resolveDocumentUrl({ requestedUrl: params.requestedUrl, finalUrl: fetched.finalUrl }),
		html: fetched.html,
		resolvedThumbnail: fetched.thumbnail,
		...(fetched.mediaType === "plain-text"
			? { mediaType: fetched.mediaType, plainText: fetched.plainText }
			: { mediaType: fetched.mediaType }),
	};
}
