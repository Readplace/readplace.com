import assert from "node:assert";
import { readerReadlists } from "@packages/domain/readlist";
import type { ListReadlistDefinitions } from "@packages/provider-contracts/article-store";
import type { AddArticleToReadlist, UpsertReadlist } from "@packages/save-article";
import type { ResolveOwnedArticle } from "./article-lookup";
import { toMcpArticle } from "./article-operations";
import type { McpReadlist, McpServerDeps } from "./mcp-server";
import type { ResolveReadlistMembership } from "./readlist-membership";

export function initMcpReadlistOperations(deps: {
	listReadlistDefinitions: ListReadlistDefinitions;
	upsertReadlist: UpsertReadlist;
	addArticleToReadlist: AddArticleToReadlist;
	resolveOwnedArticle: ResolveOwnedArticle;
	resolveReadlistMembership: ResolveReadlistMembership;
}): Pick<McpServerDeps, "listReadlists" | "createReadlist" | "addToReadlist"> {
	const listReadlists: McpServerDeps["listReadlists"] = async ({ userId }) =>
		readerReadlists(await deps.listReadlistDefinitions(userId))
			.map(({ slug, label }) => ({ id: slug, name: label }));

	const createReadlist: McpServerDeps["createReadlist"] = async ({ userId, name }) => {
		const result = await deps.upsertReadlist({ userId, name });
		switch (result.status) {
			case "ok":
				return {
					status: result.created ? "created" : "exists",
					readlist: { id: result.readlist.slug, name: result.readlist.label },
				};
			case "invalid-name":
				return { status: "invalid_name" };
			case "reserved-name":
				return {
					status: "reserved_name",
					readlist: { id: result.readlist.slug, name: result.readlist.label },
				};
			case "limit-reached":
				return { status: "limit_reached", limit: result.limit };
		}
	};

	return {
		listReadlists,
		createReadlist,
		addToReadlist: async ({ userId, id, target }) => {
			const owned = await deps.resolveOwnedArticle({ userId, id });
			if (!owned) return { status: "article_not_found" };
			let readlist: McpReadlist | undefined;
			if (target.kind === "existing") {
				readlist = (await listReadlists({ userId }))
					.find((candidate) => candidate.id === target.readlist);
				if (!readlist) return { status: "readlist_not_found" };
			} else {
				const result = await createReadlist({ userId, name: target.name });
				if (result.status !== "created" && result.status !== "exists") return result;
				readlist = result.readlist;
			}
			const { assigned } = await deps.addArticleToReadlist({
				userId,
				readlist: readlist.id,
				from: owned.readlist,
				url: owned.article.url,
			});
			const membership = await deps.resolveReadlistMembership({
				userId,
				urls: [owned.article.url],
			});
			const readlists = membership.get(owned.article.url);
			assert(readlists, "membership must include each requested URL");
			return {
				status: assigned ? "filed" : "already_filed",
				readlist,
				article: toMcpArticle(owned.article, readlists),
			};
		},
	};
}
