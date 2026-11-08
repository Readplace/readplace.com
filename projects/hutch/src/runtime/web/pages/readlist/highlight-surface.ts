import { ARTICLE_HIGHLIGHT_ID_PREFIX, type HighlightId } from "@packages/domain/article";
import { highlightFeatureParams } from "./highlight-feature";
import { type LinkParams, READLIST_PATH } from "./readlist.url";

export type HighlightReaderFragment = { highlightId: HighlightId } | "rail";

export function highlightActionUrl(input: {
	path: string;
	readlist: LinkParams;
	surface: LinkParams;
	enabled: boolean;
}): string {
	const params = new URLSearchParams();
	for (const [key, value] of [...input.readlist, ...input.surface, ...highlightFeatureParams(input.enabled)]) {
		params.append(key, value);
	}
	const search = params.toString();
	return search ? `${input.path}?${search}` : input.path;
}

export function highlightReaderLocation(input: {
	articleId: string;
	readlist: LinkParams;
	surface: LinkParams;
	enabled: boolean;
	fragment: HighlightReaderFragment;
}): string {
	const fragment = input.fragment === "rail" ? "highlights-rail" : `${ARTICLE_HIGHLIGHT_ID_PREFIX}${input.fragment.highlightId}`;
	const path = highlightActionUrl({
		path: `${READLIST_PATH}/${input.articleId}/view`,
		readlist: input.readlist,
		surface: input.surface,
		enabled: input.enabled,
	});
	return `${path}#${fragment}`;
}
