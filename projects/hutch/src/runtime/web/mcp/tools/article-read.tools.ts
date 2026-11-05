import {
	ArticleIdArgs,
	GET_ARTICLE_CONTENT_TOOL,
	GET_ARTICLE_SUMMARY_LEGACY_NAME,
	GET_RELATED_ARTICLES_LEGACY_NAME,
	GET_ARTICLE_TOOL,
} from "../tool-definitions";
import type { McpServerDeps, McpRequestContext } from "../mcp-ports.types";
import { type ToolOutputs, type ToolResult, data, toolError, NOT_AN_ARTICLE_REPLY, fitOneMcpResponse, notFoundResult, formatArticle } from "../tool-result";

export function initArticleReadTools(
	deps: Pick<McpServerDeps, "getArticle" | "getArticleContent" | "getArticleSummary" | "getRelatedArticles">,
	helpers: ToolOutputs,
) {
	const { articleOutput, relatedArticleOutput, unexpectedFailure } = helpers;

	async function runGetArticle(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) return toolError("get_article requires an `id` string.");
		try {
			const article = await deps.getArticle({
				userId: context.userId,
				id: args.data.id,
			});
			if (!article) return notFoundResult(args.data.id);
			const output = articleOutput(article);
			return data(formatArticle(output), { found: true, article: output });
		} catch (error) {
			return unexpectedFailure(
				GET_ARTICLE_TOOL.name,
				error,
				"load the article",
			);
		}
	}

	async function runGetArticleContent(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("get_article_content requires an `id` string.");
		}
		try {
			const result = await deps.getArticleContent({
				userId: context.userId,
				id: args.data.id,
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "not_an_article":
					return data(NOT_AN_ARTICLE_REPLY, result);
				case "pending":
					return data(
						"That article is still being fetched; its reader view isn't ready yet. Try again shortly.",
						result,
					);
				case "ready":
					return fitOneMcpResponse(data(result.content, result));
			}
		} catch (error) {
			return unexpectedFailure(
				GET_ARTICLE_CONTENT_TOOL.name,
				error,
				"load the article content",
			);
		}
	}

	async function runGetArticleSummary(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(`${GET_ARTICLE_SUMMARY_LEGACY_NAME} requires an \`id\` string.`);
		}
		try {
			const result = await deps.getArticleSummary({
				userId: context.userId,
				id: args.data.id,
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "not_an_article":
					return data(NOT_AN_ARTICLE_REPLY, result);
				case "pending":
					return data(
						"The AI summary for that article is still being generated. Try again shortly.",
						result,
					);
				case "ready":
					return data(result.summary, result);
				case "failed":
					return data(
						`The summary for that article could not be generated: ${result.reason}`,
						result,
					);
				case "skipped":
					return data(
						"No summary was generated for that article (it may be too short or an unsupported type).",
						result,
					);
			}
		} catch (error) {
			return unexpectedFailure(
				GET_ARTICLE_SUMMARY_LEGACY_NAME,
				error,
				"load the article summary",
			);
		}
	}

	async function runGetRelatedArticles(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(`${GET_RELATED_ARTICLES_LEGACY_NAME} requires an \`id\` string.`);
		}
		try {
			const result = await deps.getRelatedArticles({
				userId: context.userId,
				id: args.data.id,
			});
			switch (result.status) {
				case "not_found":
					return notFoundResult(args.data.id);
				case "pending":
					return data(
						"No related saves have been worked out for that article. Readplace works them out in the minutes after a reader saves a link themselves; a link saved for them from an email or an import has none.",
						result,
					);
				case "skipped":
					return data(
						"No related saves are available for that article.",
						result,
					);
				case "ready": {
					const articles = result.articles.map(relatedArticleOutput);
					return data(
						articles.length === 0
							? "No saves in the readlist relate to that article."
							: articles
									.map(
										(related) =>
											`${related.title} (${related.siteName}) [${related.status}]: ${related.url}\nReason: ${related.reason}`,
									)
									.join("\n"),
						{ ...result, articles },
					);
				}
			}
		} catch (error) {
			return unexpectedFailure(
				GET_RELATED_ARTICLES_LEGACY_NAME,
				error,
				"load the related articles",
			);
		}
	}

	return { runGetArticle, runGetArticleContent, runGetArticleSummary, runGetRelatedArticles };
}
