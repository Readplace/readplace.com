import type { ReaderArticleHashId } from "@packages/domain/article";
import type { Request } from "express";

const MARKER_KEY = "from";
const MARKER_VALUE = "reader-ready-email";

/** The clean, shareable reader permalink — no email marker. This is what
 * the owner's address bar should settle on after authentication. */
export function readerPermalinkPath(articleId: ReaderArticleHashId): string {
	return `/queue/${articleId.value}/view`;
}

export function buildOwnerReaderPath(articleId: ReaderArticleHashId): string {
	return `${readerPermalinkPath(articleId)}?${MARKER_KEY}=${MARKER_VALUE}`;
}

export function wantsOwnerLogin(query: Request["query"]): boolean {
	return query[MARKER_KEY] === MARKER_VALUE;
}
