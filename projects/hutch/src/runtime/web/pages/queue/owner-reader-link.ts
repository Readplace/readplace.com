import type { ReaderArticleHashId } from "@packages/domain/article";
import type { Request } from "express";

const MARKER_KEY = "from";
const MARKER_VALUE = "reader-ready-email";

/** The clean, shareable reader permalink — no email marker. */
function readerPermalinkPath(articleId: ReaderArticleHashId): string {
	return `/queue/${articleId.value}/view`;
}

export function buildOwnerReaderPath(articleId: ReaderArticleHashId): string {
	return `${readerPermalinkPath(articleId)}?${MARKER_KEY}=${MARKER_VALUE}`;
}

export function readerPermalinkPathWithoutMarker(
	articleId: ReaderArticleHashId,
	query: Request["query"],
): string {
	const params = new URLSearchParams(
		Object.entries(query).filter(
			(entry): entry is [string, string] =>
				entry[0] !== MARKER_KEY && typeof entry[1] === "string",
		),
	);
	const queryString = params.toString();
	return queryString
		? `${readerPermalinkPath(articleId)}?${queryString}`
		: readerPermalinkPath(articleId);
}

export function wantsOwnerLogin(query: Request["query"]): boolean {
	return query[MARKER_KEY] === MARKER_VALUE;
}
