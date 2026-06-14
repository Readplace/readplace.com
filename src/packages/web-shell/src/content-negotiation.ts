import type { Request } from "express";

export const MARKDOWN_MEDIA_TYPE = "text/markdown";

export function wantsMarkdown(req: Request): boolean {
	const acceptHeader = req.get("Accept") || "";
	if (!acceptHeader.includes(MARKDOWN_MEDIA_TYPE)) return false;
	return req.accepts(MARKDOWN_MEDIA_TYPE) === MARKDOWN_MEDIA_TYPE;
}
