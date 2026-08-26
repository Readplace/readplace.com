import { DEFAULT_QUEUE_SLUG, type QueueSlug } from "@packages/domain/queue";
import type {
	CountArticlesByUser,
	CountQueueArticles,
	DeleteArticle,
	FindArticleById,
	FindArticlesByUser,
	FindQueueArticles,
	MarkArticleViewed,
	MarkQueueArticleViewed,
} from "@packages/provider-contracts/article-store";
import {
	bindArticleStoreToQueue,
	type QueueBoundArticleStoreDependencies,
} from "@packages/save-article";

export interface QueueScopedStore {
	findArticlesByUser: FindArticlesByUser;
	countArticlesByUser: CountArticlesByUser;
	findArticleById: FindArticleById;
	deleteArticle: DeleteArticle;
	markArticleViewed: MarkArticleViewed;
}

export interface QueueScopedStoreDependencies
	extends QueueBoundArticleStoreDependencies,
		QueueScopedStore {
	findQueueArticles: FindQueueArticles;
	countQueueArticles: CountQueueArticles;
	markQueueArticleViewed: MarkQueueArticleViewed;
}

export function queueScopedStore(
	deps: QueueScopedStoreDependencies,
	queue: QueueSlug,
): QueueScopedStore {
	const mainline: QueueScopedStore = {
		findArticlesByUser: deps.findArticlesByUser,
		countArticlesByUser: deps.countArticlesByUser,
		findArticleById: deps.findArticleById,
		deleteArticle: deps.deleteArticle,
		markArticleViewed: deps.markArticleViewed,
	};
	if (queue === DEFAULT_QUEUE_SLUG) return mainline;
	return {
		...mainline,
		...bindArticleStoreToQueue(deps, queue),
		findArticlesByUser: (query) => deps.findQueueArticles({ ...query, queue }),
		countArticlesByUser: (query) => deps.countQueueArticles({ ...query, queue }),
		markArticleViewed: ({ userId, url, at }) =>
			deps.markQueueArticleViewed({ userId, queue, url, at }),
	};
}
