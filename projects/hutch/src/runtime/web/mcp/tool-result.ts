import assert from "node:assert";
import {
	DEFAULT_READLIST_SLUG,
	type ReadlistSlug,
} from "@packages/domain/readlist";
import { buildMcpReaderPath } from "../pages/readlist/owner-reader-link";
import type { McpReadlist, McpArticle, McpArticleOutput, RelatedArticleResult, RelatedArticleOutput, McpServerDeps, McpRequestContext } from "./mcp-ports.types";

interface TextContent {
	readonly type: "text";
	readonly text: string;
}

export interface ToolResult {
	readonly content: readonly TextContent[];
	readonly structuredContent?: unknown;
	readonly isError?: boolean;
}

type ToolHandler = (
	rawArgs: unknown,
	context: McpRequestContext,
) => Promise<ToolResult> | ToolResult;

export type McpToolEntry = { name: string; sortOrder: "recorded" | "not-recorded"; run: ToolHandler };

/** A successful tool result that carries both a human-readable text block (for
 * clients that only render text) and the machine-readable `structuredContent`
 * (for clients that consume structured output). */
export function data(textValue: string, structuredContent: unknown): ToolResult {
	return { content: [{ type: "text", text: textValue }], structuredContent };
}

export function toolError(value: string): ToolResult {
	return { content: [{ type: "text", text: value }], isError: true };
}

export const NOT_AN_ARTICLE_REPLY =
	"This link isn't an article, so there's no reader view — open the link itself.";

export const PENDING_REPLY =
	"That article is still being fetched; its reader view isn't ready yet. Try again shortly.";

const TOO_LARGE_FOR_MCP_REPLY =
	"This article is too large to read through the assistant. Open it in the Readplace reader instead.";

const MCP_RESPONSE_BYTE_LIMIT = 5_998_000;

export function fitOneMcpResponse(toolResult: ToolResult): ToolResult {
	const encodedBytes = Buffer.byteLength(JSON.stringify(JSON.stringify(toolResult)));
	return encodedBytes > MCP_RESPONSE_BYTE_LIMIT
		? data(TOO_LARGE_FOR_MCP_REPLY, { status: "too_large_for_mcp" })
		: toolResult;
}

export function notFoundResult(id: string): ToolResult {
	return data(`No saved article with id ${id} is in your readlist.`, {
		found: false,
	});
}

/** The text block shows a friendlier date-only value; structuredContent keeps
 * the full ISO timestamp. McpArticle dates are ISO 8601 in UTC, so the first
 * ten characters are the calendar date. */
function formatDate(iso: string): string {
	return iso.slice(0, 10);
}

export function formatReadlistNames(readlists: readonly McpReadlist[]): string {
	return readlists.map((readlist) => readlist.name).join(", ");
}

export function formatArticle(article: McpArticleOutput): string {
	const saved = article.publishedOn
		? `Published ${article.publishedOn}; saved ${formatDate(article.savedAt)}`
		: `Saved ${formatDate(article.savedAt)}`;
	const dates = article.readAt ? `${saved}; read ${formatDate(article.readAt)}` : saved;
	const excerpt = article.excerpt ? `\n${article.excerpt}` : "";
	const meta = [
		article.siteName,
		article.readTime?.label,
		`${article.wordCount} words`,
	]
		.filter((part) => part !== undefined && part !== "")
		.join(" · ");
	const readlists =
		article.readlists.length > 0
			? `\nIn readlists: ${formatReadlistNames(article.readlists)}`
			: "";
	return `"${article.title || article.url}" [${article.status}] — ${article.url}\n${meta}\n${dates}${excerpt}${readlists}`;
}

export function initToolOutputs(deps: Pick<McpServerDeps, "appOrigin" | "logError">) {
	function readerReadlist(article: Pick<McpArticle, "readlists">): ReadlistSlug | undefined {
		const readlist =
			article.readlists.find((candidate) => candidate.id === DEFAULT_READLIST_SLUG) ??
			article.readlists[0];
		assert(readlist, "an MCP article must belong to a readlist");
		return readlist.id === DEFAULT_READLIST_SLUG ? undefined : readlist.id;
	}

	function privateArticleUrl(input: {
		articleId: string;
		readlist?: ReadlistSlug;
	}): string {
		return new URL(buildMcpReaderPath(input), deps.appOrigin).toString();
	}

	function articleOutput(article: McpArticle): McpArticleOutput {
		return {
			...article,
			url: privateArticleUrl({
				articleId: article.id,
				readlist: readerReadlist(article),
			}),
		};
	}

	function relatedArticleOutput(
		article: RelatedArticleResult,
	): RelatedArticleOutput {
		return {
			...article,
			url: privateArticleUrl({ articleId: article.id }),
		};
	}

	function unexpectedFailure(
		tool: string,
		error: unknown,
		attempted: string,
	): ToolResult {
		deps.logError(
			`MCP ${tool} failed`,
			error instanceof Error ? error : undefined,
		);
		return toolError(
			`Could not ${attempted} — something went wrong on Readplace's side. Try again in a moment.`,
		);
	}

	return { readerReadlist, privateArticleUrl, articleOutput, relatedArticleOutput, unexpectedFailure };
}

export type ToolOutputs = ReturnType<typeof initToolOutputs>;
