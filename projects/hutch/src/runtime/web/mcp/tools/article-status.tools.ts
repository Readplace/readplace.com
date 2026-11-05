import type { AuthenticatedUserId } from "@packages/domain/user";
import {
	ArticleIdArgs,
	GET_ARTICLE_DELETION_STEPS_TOOL,
	MARK_AS_READ_TOOL,
	MARK_AS_UNREAD_TOOL,
} from "../tool-definitions";
import type { ArticleStatusResult, McpServerDeps, McpRequestContext } from "../mcp-ports.types";
import { type ToolOutputs, type ToolResult, data, toolError, notFoundResult, formatArticle } from "../tool-result";

export function initArticleStatusTools(
	deps: Pick<McpServerDeps, "markAsRead" | "markAsUnread" | "appOrigin">,
	helpers: ToolOutputs,
) {
	const { articleOutput, unexpectedFailure } = helpers;

	async function runStatusChange(
		change: {
			tool: string;
			confirmation: string;
			apply: (params: {
				userId: AuthenticatedUserId;
				id: string;
			}) => Promise<ArticleStatusResult>;
		},
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ArticleIdArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(`${change.tool} requires an \`id\` string.`);
		}
		try {
			const result = await change.apply({
				userId: context.userId,
				id: args.data.id,
			});
			if (result.status === "not_found") return notFoundResult(args.data.id);
			const article = articleOutput(result.article);
			return data(`${change.confirmation}\n${formatArticle(article)}`, {
				found: true,
				marked: true,
				article,
			});
		} catch (error) {
			return unexpectedFailure(
				change.tool,
				error,
				"change the article's status",
			);
		}
	}

	function runMarkAsRead(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		return runStatusChange(
			{
				tool: MARK_AS_READ_TOOL.name,
				confirmation:
					"Marked read — it stays in your Readplace readlist and has left your unread list.",
				apply: deps.markAsRead,
			},
			rawArgs,
			context,
		);
	}

	function runMarkAsUnread(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		return runStatusChange(
			{
				tool: MARK_AS_UNREAD_TOOL.name,
				confirmation: "Marked unread — it is back in your unread list.",
				apply: deps.markAsUnread,
			},
			rawArgs,
			context,
		);
	}

	function runGetArticleDeletionSteps(): ToolResult {
		const readlistUrl = new URL("/queue", deps.appOrigin).toString();
		return data(
			`Deleting a saved article is done in the Readplace app, not by your assistant, so nothing is removed by mistake. Open your readlist at ${readlistUrl} to delete an article.`,
			{
				action: GET_ARTICLE_DELETION_STEPS_TOOL.name,
				performed: false,
				completeInApp: readlistUrl,
			},
		);
	}

	return { runMarkAsRead, runMarkAsUnread, runGetArticleDeletionSteps };
}
