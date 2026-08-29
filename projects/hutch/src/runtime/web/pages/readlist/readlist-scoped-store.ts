import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type {
	CountArticlesByUser,
	CountReadlistArticles,
	DeleteArticle,
	FindArticleById,
	FindArticlesByUser,
	FindReadlistArticles,
	MarkArticleViewed,
	MarkReadlistArticleViewed,
} from "@packages/provider-contracts/article-store";
import {
	bindArticleStoreToReadlist,
	type ReadlistBoundArticleStoreDependencies,
} from "@packages/save-article";

export interface ReadlistScopedStore {
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	findArticleById: FindArticleById;
	deleteArticle: DeleteArticle;
	markArticleViewed: MarkArticleViewed;
}

export interface ReadlistScopedStoreDependencies
	extends ReadlistBoundArticleStoreDependencies,
		ReadlistScopedStore {
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
}

export function readlistScopedStore(
	deps: ReadlistScopedStoreDependencies,
	readlist: ReadlistSlug,
): ReadlistScopedStore {
	const mainline: ReadlistScopedStore = {
		findArticlesByUser: deps.findArticlesByUser,
		countArticlesByUser: deps.countArticlesByUser,
		findArticleById: deps.findArticleById,
		deleteArticle: deps.deleteArticle,
		markArticleViewed: deps.markArticleViewed,
	};
	if (readlist === DEFAULT_READLIST_SLUG) return mainline;
	return {
		...mainline,
		...bindArticleStoreToReadlist(deps, readlist),
		findArticlesByUser: (query) => deps.findReadlistArticles({ ...query, readlist }),
		countArticlesByUser: (query) => deps.countReadlistArticles({ ...query, readlist }),
		markArticleViewed: ({ userId, url, at }) =>
			deps.markReadlistArticleViewed({ userId, readlist, url, at }),
	};
}
