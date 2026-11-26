import { newsletterSourceStore, type NewsletterSourceDependencies } from "./newsletter-source";
import type { ManagedArticleSource } from "./readlist.url";
import { HAND_PICKED_SCOPE } from "./built-in-readlists";
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
	extends ReadlistBoundArticleStoreDependencies, NewsletterSourceDependencies,
		ReadlistScopedStore {
	findReadlistArticles: FindReadlistArticles;
	countReadlistArticles: CountReadlistArticles;
	markReadlistArticleViewed: MarkReadlistArticleViewed;
}

export function readlistScopedStore(
	deps: ReadlistScopedStoreDependencies,
	readlist: ReadlistSlug,
	managedSource?: ManagedArticleSource,
	sender?: string,
): ReadlistScopedStore {
	const mainline: ReadlistScopedStore = {
		findArticlesByUser: deps.findArticlesByUser,
		countArticlesByUser: deps.countArticlesByUser,
		findArticleById: deps.findArticleById,
		deleteArticle: deps.deleteArticle,
		markArticleViewed: deps.markArticleViewed,
	};
	if (readlist === DEFAULT_READLIST_SLUG && managedSource === "sender") return { ...mainline, ...newsletterSourceStore(deps, sender) };
	if (readlist === DEFAULT_READLIST_SLUG && (managedSource === "bulk" || managedSource === "unknown")) return {
		...mainline,
		findArticlesByUser: query => deps.findArticlesByUser({ ...query, managedOrigin: managedSource }),
		countArticlesByUser: query => deps.countArticlesByUser({ ...query, managedOrigin: managedSource }),
	};
	if (readlist === DEFAULT_READLIST_SLUG && !managedSource) return mainline;
	if (readlist === HAND_PICKED_SCOPE || managedSource === "picked") return {
		...mainline,
		findArticlesByUser: query => deps.findArticlesByUser({ ...query, personalScope: "picked" }),
		countArticlesByUser: async query => {
			if (query.status) return deps.countArticlesByUser({ ...query, personalScope: "picked" });
			const unread = await deps.countArticlesByUser({ ...query, personalScope: "picked", status: "unread" });
			if (query.countLimit !== undefined && unread >= query.countLimit) return query.countLimit;
			return unread + await deps.countArticlesByUser({ ...query, countLimit: query.countLimit === undefined ? undefined : query.countLimit - unread, personalScope: "picked", status: "read" });
		},
		findArticleById: async (id, userId) => {
			const article = await deps.findArticleById(id, userId);
			return article?.personalPickedAt ? article : null;
		},
	};
	return {
		...mainline,
		...bindArticleStoreToReadlist(deps, readlist),
		findArticlesByUser: (query) => deps.findReadlistArticles({ ...query, readlist }),
		countArticlesByUser: (query) => deps.countReadlistArticles({ ...query, readlist }),
		markArticleViewed: ({ userId, url, at }) =>
			deps.markReadlistArticleViewed({ userId, readlist, url, at }),
	};
}
