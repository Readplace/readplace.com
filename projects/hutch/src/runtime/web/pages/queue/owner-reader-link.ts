import type { ReaderArticleHashId } from "@packages/domain/article";
import type { Request } from "express";

const MARKER_KEY = "from";
const MARKER_VALUE = "reader-ready-email";

export function buildOwnerReaderPath(articleId: ReaderArticleHashId): string {
	return `/queue/${articleId.value}/view?${MARKER_KEY}=${MARKER_VALUE}`;
}

export function wantsOwnerLogin(query: Request["query"]): boolean {
	return query[MARKER_KEY] === MARKER_VALUE;
}
