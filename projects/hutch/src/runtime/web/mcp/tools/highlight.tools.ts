import { HIGHLIGHT_NOTE_MAX_LENGTH } from "@packages/domain/article";
import { HIGHLIGHT_MAX_EXACT_LENGTH } from "@packages/domain/article/highlight";
import type { ReadlistSlug } from "@packages/domain/readlist";
import { ORPHAN_SUFFIX } from "../../shared/epub/highlights-xhtml";
import {
	ArticleIdArgs,
	CREATE_HIGHLIGHT_TOOL,
	CreateHighlightArgs,
	LIST_HIGHLIGHTS_TOOL,
	TEXT_BEFORE_MAX_LENGTH,
} from "../tool-definitions";
import type { McpHighlight, McpHighlightOutput, McpServerDeps, McpRequestContext } from "../mcp-ports.types";
import { type ToolOutputs, type ToolResult, data, toolError, NOT_AN_ARTICLE_REPLY, PENDING_REPLY, notFoundResult } from "../tool-result";

function formatHighlight(highlight: McpHighlightOutput): string {
	const lines = highlight.quote.split("\n").map((line) => `> ${line}`);
	const quoted = highlight.state === "orphaned" ? `${lines.join("\n")}${ORPHAN_SUFFIX}` : lines.join("\n");
	return highlight.note === undefined ? quoted : `${quoted}\n${highlight.note}`;
}

export function initHighlightTools(
	deps: Pick<McpServerDeps, "listHighlights" | "createHighlight">,
	helpers: ToolOutputs,
) {
	const { privateArticleUrl, unexpectedFailure } = helpers;

	function highlightOutput(params: {
		articleId: string;
		readlist: ReadlistSlug;
		highlight: McpHighlight;
	}): McpHighlightOutput {
		const url = new URL(privateArticleUrl({ articleId: params.articleId, readlist: params.readlist }));
		if (params.highlight.state !== "orphaned") url.hash = `highlight-${params.highlight.id}`;
		return { ...params.highlight, url: url.toString() };
	}

	async function runListHighlights(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) return toolError("list_highlights requires an `id` string.");
		try {
			const result = await deps.listHighlights({ userId: context.userId, id: args.data.id });
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "not_an_article":
					return data(NOT_AN_ARTICLE_REPLY, result);
				case "pending":
					return data(PENDING_REPLY, result);
				case "ready": {
					const highlights = result.highlights.map((highlight) =>
						highlightOutput({ articleId: result.articleId, readlist: result.readlist, highlight }),
					);
					const text =
						highlights.length === 0
							? "This article has no highlights yet."
							: highlights.map(formatHighlight).join("\n\n");
					return data(text, { articleId: result.articleId, highlights });
				}
			}
		} catch (error) {
			return unexpectedFailure(LIST_HIGHLIGHTS_TOOL.name, error, "list the highlights");
		}
	}

	async function runCreateHighlight(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = CreateHighlightArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(
				`create_highlight requires an \`id\` string and a \`quote\` of 1–${HIGHLIGHT_MAX_EXACT_LENGTH} characters; \`note\` (up to ${HIGHLIGHT_NOTE_MAX_LENGTH} characters) and \`text_before\` (1–${TEXT_BEFORE_MAX_LENGTH} characters) are optional.`,
			);
		}
		try {
			const result = await deps.createHighlight({
				userId: context.userId,
				id: args.data.id,
				quote: args.data.quote,
				...(args.data.note === undefined ? {} : { note: args.data.note }),
				...(args.data.text_before === undefined ? {} : { textBefore: args.data.text_before }),
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "not_an_article":
					return data(NOT_AN_ARTICLE_REPLY, result);
				case "pending":
					return data(PENDING_REPLY, result);
				case "created":
				case "merged": {
					const highlight = highlightOutput(result);
					const heading =
						result.status === "created"
							? "Highlighted:"
							: `Merged with an existing highlight, which now has the id ${highlight.id}:`;
					return data(`${heading}\n${formatHighlight(highlight)}\nOpen it: ${highlight.url}`, {
						outcome: result.status,
						highlight,
					});
				}
				case "quote_not_found":
					return toolError(
						"That quote is not in the article's current text. Copy it exactly from get_article_content.",
					);
				case "quote_ambiguous":
					return toolError(
						`That quote appears ${result.matches} times in the article. Call create_highlight again with text_before holding the text just before the passage you mean.`,
					);
				case "too_long":
					return toolError(
						`That highlight would be longer than ${result.limit} characters, counting any highlight it merges with and its note. Quote a shorter passage or write a shorter note.`,
					);
				case "conflict":
					return toolError(
						"This article's highlights changed while saving this one, so nothing was saved. Call create_highlight again.",
					);
				case "access_denied":
					return toolError(result.message);
			}
		} catch (error) {
			return unexpectedFailure(CREATE_HIGHLIGHT_TOOL.name, error, "save the highlight");
		}
	}

	return { runListHighlights, runCreateHighlight };
}
