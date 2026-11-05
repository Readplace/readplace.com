import assert from "node:assert";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	ArticleStatus,
} from "@packages/domain/article";
import {
	DEFAULT_READLIST_SLUG,
} from "@packages/domain/readlist";
import type {
	SortField,
	SortOrder,
} from "@packages/provider-contracts/article-store";
import { decodeReadlistCursor, encodeReadlistCursor } from "../cursor";
import {
	AddToReadlistArgs,
	CreateReadlistArgs,
	CREATE_READLIST_TOOL,
	ADD_TO_READLIST_TOOL,
	LIST_READLISTS_TOOL,
	LIST_READLIST_ARTICLES_TOOL,
	ListReadlistArticlesArgs,
	SAVE_LINK_TOOL,
} from "../tool-definitions";
import type { McpReadlist, McpServerDeps, McpRequestContext } from "../mcp-ports.types";
import { type ToolOutputs, type ToolResult, data, toolError, notFoundResult, formatArticle } from "../tool-result";

export function requestedSortOrder(rawArgs: unknown): SortOrder | undefined {
	const args = ListReadlistArticlesArgs.safeParse(rawArgs);
	if (!args.success) return undefined;
	if (args.data.cursor === undefined) return args.data.order;
	return decodeReadlistCursor(args.data.cursor)?.order;
}

export function initReadlistTools(
	deps: Pick<McpServerDeps, "listReadlists" | "listReadlist" | "createReadlist" | "addToReadlist">,
	helpers: ToolOutputs,
) {
	const { articleOutput, unexpectedFailure } = helpers;

	async function resolveReadlistIds(
		userId: AuthenticatedUserId,
		ids: readonly string[],
	): Promise<
		| { readonly ok: true; readonly readlists: readonly McpReadlist[] }
		| { readonly ok: false; readonly unknownId: string }
	> {
		const owned = await deps.listReadlists({ userId });
		const byId = new Map<string, McpReadlist>(
			owned.map((readlist) => [readlist.id, readlist]),
		);
		const readlists: McpReadlist[] = [];
		for (const id of ids) {
			const match = byId.get(id);
			if (!match) return { ok: false, unknownId: id };
			readlists.push(match);
		}
		return { ok: true, readlists };
	}

	async function runListReadlistArticles(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = ListReadlistArticlesArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(
				'list_readlist_articles arguments are invalid: `status` must be "unread" or "read", `sort` "saved" or "read", `order` "asc" or "desc".',
			);
		}
		try {
			const a = args.data;

			let page: number;
			let pageSize: number | undefined;
			let requestedReadlist: string | undefined;
			let status: ArticleStatus | undefined;
			let sort: SortField | undefined;
			let order: SortOrder | undefined;
			if (a.cursor !== undefined) {
				const decoded = decodeReadlistCursor(a.cursor);
				if (!decoded) {
					return toolError(
						"That pagination cursor is invalid. Call list_readlist_articles again without a cursor to start from the first page.",
					);
				}
				page = decoded.page;
				pageSize = decoded.pageSize;
				status = decoded.status;
				sort = decoded.sort;
				order = decoded.order;
				requestedReadlist =
					decoded.scope === "combined"
						? undefined
						: (decoded.readlist ?? DEFAULT_READLIST_SLUG);
			} else {
				requestedReadlist = a.readlist;
				sort =
					a.sort === "read"
						? "readAt"
						: a.sort === "saved"
							? "savedAt"
							: undefined;
				if (sort === "readAt" && a.status !== "read") {
					return toolError(
						'Sorting by read date (`sort:"read"`) only applies to read articles — pass `status:"read"` as well.',
					);
				}
				page = 1;
				pageSize = a.limit;
				status = a.status;
				order = a.order;
			}

			let selectedReadlist: McpReadlist | undefined;
			if (requestedReadlist !== undefined) {
				const resolved = await resolveReadlistIds(context.userId, [
					requestedReadlist,
				]);
				if (!resolved.ok) {
					return toolError(
						`No readlist with id ${resolved.unknownId}. Call list_readlists and pass one of the ids it returns.`,
					);
				}
				selectedReadlist = resolved.readlists[0];
			}
			const readlist = selectedReadlist?.id;
			const outcome = await deps.listReadlist({
				userId: context.userId,
				readlist,
				status,
				sort,
				order,
				page,
				pageSize,
			});
			const hasMore = outcome.page * outcome.pageSize < outcome.total;
			const nextCursor = hasMore
				? encodeReadlistCursor({
						page: outcome.page + 1,
						pageSize: outcome.pageSize,
						...(readlist === undefined ? { scope: "combined" as const } : { readlist }),
						status,
						sort,
						order,
					})
				: undefined;
			const articles = outcome.articles.map(articleOutput);
			const structuredContent = {
				articles,
				total: outcome.total,
				count: articles.length,
				...(selectedReadlist !== undefined
					? { readlist: selectedReadlist }
					: {}),
				...(nextCursor ? { nextCursor } : {}),
			};
			const where =
				selectedReadlist !== undefined ? ` in ${selectedReadlist.name}` : "";

			if (articles.length === 0) {
				return data(
					outcome.total === 0
						? selectedReadlist === undefined
							? `Your Readplace readlist is empty. Ask the user for a link they want to read later and save it with ${SAVE_LINK_TOOL.name}.`
							: `Your Readplace readlist${where} is empty.`
						: "No more saved articles.",
					structuredContent,
				);
			}

			const lines = articles.map(
				(article) =>
					`- ${article.title || article.url} [${article.status}] ${article.url}`,
			);
			const shown = articles.length;
			let header: string;
			if (outcome.page > 1) {
				header = `Showing ${shown} more of your ${outcome.total} saved article(s)${where}:`;
			} else if (shown < outcome.total) {
				header = `You have ${outcome.total} saved article(s)${where}; showing the first ${shown}:`;
			} else {
				header = `You have ${outcome.total} saved article(s)${where}:`;
			}
			return data(`${header}\n${lines.join("\n")}`, structuredContent);
		} catch (error) {
			return unexpectedFailure(
				LIST_READLIST_ARTICLES_TOOL.name,
				error,
				"list your readlist",
			);
		}
	}

	async function runListReadlists(
		context: McpRequestContext,
	): Promise<ToolResult> {
		try {
			const readlists = await deps.listReadlists({ userId: context.userId });
			const lines = readlists.map(
				(readlist) => `- ${readlist.name} (id ${readlist.id})`,
			);
			return data(
				`You have ${readlists.length} readlist(s):\n${lines.join("\n")}`,
				{ readlists },
			);
		} catch (error) {
			return unexpectedFailure(
				LIST_READLISTS_TOOL.name,
				error,
				"list your readlists",
			);
		}
	}

	async function runCreateReadlist(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = CreateReadlistArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("create_readlist requires a `name` string.");
		}
		try {
			const result = await deps.createReadlist({
				userId: context.userId,
				name: args.data.name,
			});
			switch (result.status) {
				case "created":
					return data(
						`Created readlist "${result.readlist.name}". Its id is ${result.readlist.id} — pass that to add_to_readlist, save_link, or list_readlist_articles.`,
						result,
					);
				case "exists":
					return data(
						`"${result.readlist.name}" already exists (id ${result.readlist.id}); reusing it rather than making a second one.`,
						result,
					);
				case "access_denied":
					return toolError(result.message);
				case "invalid_name":
					return toolError(
						"A readlist name must be 1–24 characters after trimming. Pick a shorter name.",
					);
				case "reserved_name":
					return toolError(
						`"${result.readlist.name}" is reserved because All already receives every save. Use its id from list_readlists to file an article back into it, or choose a different name.`,
					);
				case "limit_reached":
					return toolError(
						`This reader already has the maximum of ${result.limit} readlists. Ask them to delete one in the Readplace app, or file into an existing one.`,
					);
			}
		} catch (error) {
			return unexpectedFailure(
				CREATE_READLIST_TOOL.name,
				error,
				"create the readlist",
			);
		}
	}

	async function runAddToReadlist(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = AddToReadlistArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError(
				"add_to_readlist requires an `id` and exactly one of `readlist` or `create_name`.",
			);
		}
		try {
			let target: Parameters<McpServerDeps["addToReadlist"]>[0]["target"];
			if (args.data.readlist !== undefined) {
				const resolved = await resolveReadlistIds(context.userId, [
					args.data.readlist,
				]);
				if (!resolved.ok) {
					return toolError(
						`No readlist with id ${resolved.unknownId}. Call list_readlists and pass one of the ids it returns.`,
					);
				}
				target = { kind: "existing", readlist: resolved.readlists[0].id };
			} else {
				assert(args.data.create_name !== undefined);
				target = { kind: "create", name: args.data.create_name };
			}
			const result = await deps.addToReadlist({
				userId: context.userId,
				id: args.data.id,
				target,
			});
			switch (result.status) {
				case "filed": {
					const article = articleOutput(result.article);
					return data(
						`Filed into "${result.readlist.name}".\n${formatArticle(article)}`,
						{ ...result, article },
					);
				}
				case "already_filed": {
					const article = articleOutput(result.article);
					return data(
						`Already in "${result.readlist.name}"; nothing changed.\n${formatArticle(article)}`,
						{ ...result, article },
					);
				}
				case "article_not_found":
					return notFoundResult(args.data.id);
				case "readlist_not_found":
					return toolError(
						`No readlist with id ${args.data.readlist}. Call list_readlists and pass one of the ids it returns.`,
					);
				case "access_denied":
					return toolError(result.message);
				case "invalid_name":
					return toolError(
						"A readlist name must be 1–24 characters after trimming. Pick a shorter name.",
					);
				case "reserved_name":
					return toolError(
						`"${result.readlist.name}" is reserved because All already receives every save. Use its id from list_readlists to file an article back into it, or choose a different name.`,
					);
				case "limit_reached":
					return toolError(
						`This reader already has the maximum of ${result.limit} readlists, so a new one can't be created. Ask them to delete one in the Readplace app, or file into an existing one.`,
					);
			}
		} catch (error) {
			return unexpectedFailure(
				ADD_TO_READLIST_TOOL.name,
				error,
				"add the article to the readlist",
			);
		}
	}

	return { resolveReadlistIds, runListReadlistArticles, runListReadlists, runCreateReadlist, runAddToReadlist };
}
