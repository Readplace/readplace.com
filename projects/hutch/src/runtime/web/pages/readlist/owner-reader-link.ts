import type { ReaderArticleHashId } from "@packages/domain/article";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import type { Request } from "express";

const MARKER_KEY = "from";
const MARKER_VALUE = "reader-ready-email";
const MCP_MARKER_VALUE = "mcp";
const OWNER_LOGIN_MARKERS = new Set([MARKER_VALUE, MCP_MARKER_VALUE]);

/** The clean, shareable reader permalink — no email marker. */
function readerPermalinkPath(articleId: ReaderArticleHashId | string): string {
	const value = typeof articleId === "string" ? articleId : articleId.value;
	return `/queue/${value}/view`;
}

export function buildOwnerReaderPath(articleId: ReaderArticleHashId): string {
	return `${readerPermalinkPath(articleId)}?${MARKER_KEY}=${MARKER_VALUE}`;
}

export function buildMcpReaderPath(input: {
	articleId: string;
	readlist?: ReadlistSlug;
}): string {
	const params = new URLSearchParams([[MARKER_KEY, MCP_MARKER_VALUE]]);
	if (
		input.readlist !== undefined &&
		input.readlist !== DEFAULT_READLIST_SLUG
	) {
		params.append("queue", input.readlist);
	}
	return `${readerPermalinkPath(input.articleId)}?${params.toString()}`;
}

function scalarQueryParams(query: Request["query"]): URLSearchParams {
	return new URLSearchParams(
		Object.entries(query).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

export function ownerReaderLoginPath(
	articleId: ReaderArticleHashId,
	query: Request["query"],
): string {
	return `${readerPermalinkPath(articleId)}?${scalarQueryParams(query).toString()}`;
}

export function readerPermalinkPathWithoutMarker(
	articleId: ReaderArticleHashId,
	query: Request["query"],
): string {
	const params = scalarQueryParams(query);
	params.delete(MARKER_KEY);
	const queryString = params.toString();
	return queryString
		? `${readerPermalinkPath(articleId)}?${queryString}`
		: readerPermalinkPath(articleId);
}

export function wantsOwnerLogin(query: Request["query"]): boolean {
	const marker = query[MARKER_KEY];
	return typeof marker === "string" && OWNER_LOGIN_MARKERS.has(marker);
}
