import { readerReadlists, readlistsHoldingArticle } from "@packages/domain/readlist";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	ListReadlistDefinitions,
	ListUserSavesForUrls,
} from "@packages/provider-contracts/article-store";
import type { McpReadlist } from "./mcp-server";

export type ResolveReadlistMembership = (params: {
	userId: AuthenticatedUserId;
	urls: readonly string[];
}) => Promise<ReadonlyMap<string, readonly McpReadlist[]>>;

export function initResolveReadlistMembership(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	listUserSavesForUrls: ListUserSavesForUrls;
}): ResolveReadlistMembership {
	return async ({ userId, urls }) => {
		if (urls.length === 0) return new Map();
		const readlists = readerReadlists(await deps.listReadlistDefinitions(userId));
		const saves = await deps.listUserSavesForUrls({
			userId,
			urls,
			readlists: readlists.map((readlist) => readlist.slug),
		});
		return new Map(urls.map((url) => [
			url,
			readlistsHoldingArticle({ saves: saves.get(url) ?? [], readlists })
				.map(({ slug, label }) => ({ id: slug, name: label })),
		]));
	};
}
