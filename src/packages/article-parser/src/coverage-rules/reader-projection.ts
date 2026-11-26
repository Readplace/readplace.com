import { parseHTML } from "linkedom";
import { sanitizeArticleHtml } from "@packages/domain/article";
import type { MediaUrlMap, ReaderProjection } from "./coverage-rule.types";

export function projectReaderHtml(params: { html: string; media: MediaUrlMap }): ReaderProjection {
	const { document } = parseHTML(`<div id="root">${sanitizeArticleHtml(params.html)}</div>`);
	return { document, media: params.media };
}
