import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type {
	AllocateSavedAt,
	AssignSavedArticleToReadlist,
} from "@packages/provider-contracts/article-store";

export interface AddArticleToReadlistDependencies {
	allocateSavedAt: AllocateSavedAt;
	assignSavedArticleToReadlist: AssignSavedArticleToReadlist;
}

export type AddArticleToReadlist = (params: {
	userId: UserId;
	readlist: ReadlistSlug;
	from: ReadlistSlug;
	url: string;
}) => Promise<{ assigned: boolean }>;

export function initAddArticleToReadlist(
	deps: AddArticleToReadlistDependencies,
): AddArticleToReadlist {
	return async ({ userId, readlist, from, url }) =>
		deps.assignSavedArticleToReadlist({
			userId,
			readlist,
			from,
			url,
			savedAt: await deps.allocateSavedAt({ userId }),
		});
}
