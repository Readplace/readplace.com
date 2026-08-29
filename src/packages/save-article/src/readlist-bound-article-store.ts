import assert from "node:assert";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type {
	DeleteArticle,
	DeleteReadlistArticle,
	FindArticleById,
	FindReadlistArticleById,
	ListUserSavesForUrl,
} from "@packages/provider-contracts/article-store";
import type { PublishLinkDequeued } from "@packages/provider-contracts/events";

export interface ReadlistBoundArticleStoreDependencies {
	deleteReadlistArticle: DeleteReadlistArticle;
	findReadlistArticleById: FindReadlistArticleById;
}

export function bindArticleStoreToReadlist(
	deps: ReadlistBoundArticleStoreDependencies,
	readlist: ReadlistSlug,
): {
	deleteArticle: DeleteArticle;
	findArticleById: FindArticleById;
} {
	assert(readlist !== DEFAULT_READLIST_SLUG, "the default readlist is served by the unbound article store");
	return {
		deleteArticle: (id, userId) => deps.deleteReadlistArticle({ id, userId, readlist }),
		findArticleById: (id, userId) => deps.findReadlistArticleById({ id, userId, readlist }),
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
