import type { Request } from "express";
import { SIREN_MEDIA_TYPE } from "./api/siren";

export const MARKDOWN_MEDIA_TYPE = "text/markdown";

export function wantsSiren(req: Request): boolean {
	const acceptHeader = req.get("Accept") || "";
	if (!acceptHeader.includes(SIREN_MEDIA_TYPE)) return false;
	return req.accepts(SIREN_MEDIA_TYPE) === SIREN_MEDIA_TYPE;
}

export function wantsMarkdown(req: Request): boolean {
	const acceptHeader = req.get("Accept") || "";
	if (!acceptHeader.includes(MARKDOWN_MEDIA_TYPE)) return false;
	return req.accepts(MARKDOWN_MEDIA_TYPE) === MARKDOWN_MEDIA_TYPE;
}
