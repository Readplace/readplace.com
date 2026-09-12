import { ReaderArticleHashIdSchema } from "@packages/domain/article";
import type { SavedArticle } from "@packages/domain/article";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { AuthenticatedUserId } from "@packages/domain/user";
import type {
	FindArticleById,
	FindReadlistArticleById,
	ListReadlistDefinitions,
} from "@packages/provider-contracts/article-store";

export interface OwnedArticle {
	readonly article: SavedArticle;
	readonly readlist: ReadlistSlug;
}

export type ResolveOwnedArticle = (params: {
	userId: AuthenticatedUserId;
	id: string;
}) => Promise<OwnedArticle | null>;

export function initResolveOwnedArticle(deps: {
	findArticleById: FindArticleById;
	findReadlistArticleById: FindReadlistArticleById;
	listReadlistDefinitions: ListReadlistDefinitions;
}): ResolveOwnedArticle {
	return async ({ userId, id }) => {
		const parsed = ReaderArticleHashIdSchema.safeParse(id);
		if (!parsed.success) return null;
		const mainline = await deps.findArticleById(parsed.data, userId);
		if (mainline) return { article: mainline, readlist: DEFAULT_READLIST_SLUG };
		const definitions = await deps.listReadlistDefinitions(userId);
		for (const definition of definitions) {
			const found = await deps.findReadlistArticleById({
				id: parsed.data,
				userId,
				readlist: definition.slug,
			});
			if (found) return { article: found, readlist: definition.slug };
		}
		return null;
	};
}
