import assert from "node:assert";
import { DEFAULT_QUEUE_SLUG, type QueueSlug } from "@packages/domain/queue";
import type {
	DeleteArticle,
	DeleteQueueArticle,
	FindArticleById,
	FindQueueArticleById,
	ListUserSavesForUrl,
	SaveArticle,
	SaveQueueArticle,
	UpdateArticleStatus,
	UpdateQueueArticleStatus,
} from "@packages/provider-contracts/article-store";
import type { PublishLinkDequeued } from "@packages/provider-contracts/events";

export interface QueueBoundArticleStoreDependencies {
	saveQueueArticle: SaveQueueArticle;
	updateQueueArticleStatus: UpdateQueueArticleStatus;
	deleteQueueArticle: DeleteQueueArticle;
	findQueueArticleById: FindQueueArticleById;
}

export function bindArticleStoreToQueue(
	deps: QueueBoundArticleStoreDependencies,
	queue: QueueSlug,
): {
	saveArticle: SaveArticle;
	updateArticleStatus: UpdateArticleStatus;
	deleteArticle: DeleteArticle;
	findArticleById: FindArticleById;
} {
	assert(queue !== DEFAULT_QUEUE_SLUG, "the default queue is served by the unbound article store");
	return {
		saveArticle: (params) => deps.saveQueueArticle({ ...params, queue }),
		updateArticleStatus: (id, userId, status) =>
			deps.updateQueueArticleStatus({ id, userId, queue, status }),
		deleteArticle: (id, userId) => deps.deleteQueueArticle({ id, userId, queue }),
		findArticleById: (id, userId) => deps.findQueueArticleById({ id, userId, queue }),
	};
}

export function initPublishLinkDequeuedUnlessSavedElsewhere(deps: {
	listUserSavesForUrl: ListUserSavesForUrl;
	publishLinkDequeued: PublishLinkDequeued;
}): PublishLinkDequeued {
	return async ({ url, userId }) => {
		const remaining = await deps.listUserSavesForUrl({ userId, url });
		if (remaining.length > 0) return;
		await deps.publishLinkDequeued({ url, userId });
	};
}
