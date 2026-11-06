import type { AuthenticatedUserId } from "@packages/domain/user";
import {
	DEFAULT_READLIST_SLUG,
} from "@packages/domain/readlist";
import {
	SAVE_LINK_TOOL,
	SaveLinkArgs,
} from "../tool-definitions";
import type { McpReadlist, McpServerDeps, McpRequestContext } from "../mcp-ports.types";
import { type ToolOutputs, type ToolResult, data, toolError, formatReadlistNames, } from "../tool-result";

export function submittedSaveUrl(
	name: string,
	rawArgs: unknown,
): string | undefined {
	if (name !== SAVE_LINK_TOOL.name) return undefined;
	const args = SaveLinkArgs.safeParse(rawArgs);
	return args.success ? args.data.url : undefined;
}

export function initSaveLinkTool(
	deps: Pick<McpServerDeps, "saveLink">,
	helpers: ToolOutputs & {
		resolveReadlistIds: (
			userId: AuthenticatedUserId,
			ids: readonly string[],
		) => Promise<
			| { readonly ok: true; readonly readlists: readonly McpReadlist[] }
			| { readonly ok: false; readonly unknownId: string }
		>;
	},
) {
	const { readerReadlist, privateArticleUrl, unexpectedFailure, resolveReadlistIds } = helpers;

	async function runSaveLink(
		rawArgs: unknown,
		context: McpRequestContext,
	): Promise<ToolResult> {
		const args = SaveLinkArgs.safeParse(rawArgs);
		if (!args.success) {
			return toolError("save_link requires a `url` string.");
		}
		try {
			const requested = args.data.readlists ?? [];
			let named: readonly McpReadlist[] = [];
			if (requested.length > 0) {
				const resolved = await resolveReadlistIds(context.userId, requested);
				if (!resolved.ok) {
					return toolError(
						`No readlist with id ${resolved.unknownId}. Call list_readlists and pass one of the ids it returns. Nothing was saved.`,
					);
				}
				named = resolved.readlists;
			}
			const outcome = await deps.saveLink({
				userId: context.userId,
				url: args.data.url,
				readlists: named.map((readlist) => readlist.id),
				oauthClientId: context.oauthClientId,
			});
			if (!outcome.ok) return toolError(outcome.message);
			if ("pending" in outcome) return data("This link is queued while Readplace resolves the original article. Check your readlist for the saved article.", { status: "pending" });
			const filed = outcome.filedInto.filter(
				(readlist) => readlist.id !== DEFAULT_READLIST_SLUG,
			);
			const where =
				filed.length > 0
					? ` and filed it into ${formatReadlistNames(filed)}`
					: "";
			const savedArticleUrl = privateArticleUrl({
				articleId: outcome.id,
				readlist: readerReadlist({ readlists: outcome.filedInto }),
			});
			return data(
				`Saved "${outcome.title}" to your Readplace readlist${where}. Read in Readplace: ${savedArticleUrl}\nThe reader view is loading in the background.`,
				{
					id: outcome.id,
					title: outcome.title,
					url: savedArticleUrl,
					readlists: outcome.filedInto,
				},
			);
		} catch (error) {
			return unexpectedFailure(SAVE_LINK_TOOL.name, error, "save the link");
		}
	}

	return { runSaveLink };
}
