import { DEFAULT_READLIST_SLUG, type ReadlistRef, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { CountReadlistArticles } from "@packages/provider-contracts/article-store";

export type FindNonEmptyReadlists = (query: {
	userId: UserId;
	readlists: readonly ReadlistRef[];
}) => Promise<readonly ReadlistSlug[]>;

export function initFindNonEmptyReadlists(deps: {
	countReadlistArticles: CountReadlistArticles;
}): FindNonEmptyReadlists {
	return async ({ userId, readlists }) => {
		const owned = readlists.filter((readlist) => readlist.slug !== DEFAULT_READLIST_SLUG);
		if (owned.length < 2) return [];
		const counts = await Promise.all(
			owned.map((readlist) => deps.countReadlistArticles({ userId, readlist: readlist.slug, countLimit: 1 })),
		);
		return owned.filter((_readlist, index) => counts[index] > 0).map((readlist) => readlist.slug);
	};
}
