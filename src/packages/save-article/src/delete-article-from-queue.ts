import type { DeleteArticle, FindArticleUrlById } from "@packages/provider-contracts/article-store";
import type { PublishLinkDequeued } from "@packages/provider-contracts/events";
import type { ReaderArticleHashId } from "@packages/domain/article";
import type { UserId } from "@packages/domain/user";

export interface DeleteArticleFromQueueDependencies {
	deleteArticle: DeleteArticle;
	findArticleUrlById: FindArticleUrlById;
	publishLinkDequeued: PublishLinkDequeued;
}

/** Drops a reader's queue row and announces that it is gone, so every surface
 * that answers "is this in your queue?" hears about a delete the same way it
 * hears about a save.
 *
 * The fact is published even when the row was already gone: the row may have
 * been deleted by an earlier attempt whose publish failed after the delete
 * committed, and the retry of that request is the only chance to re-announce
 * it. The consumer retracts idempotently, so a duplicate fact is harmless
 * while a suppressed one leaves the link reading as saved for good. */
export function initDeleteArticleFromQueue(
	deps: DeleteArticleFromQueueDependencies,
): (params: { articleId: ReaderArticleHashId; userId: UserId }) => Promise<boolean> {
	return async ({ articleId, userId }) => {
		const url = await deps.findArticleUrlById(articleId);
		if (url === null) return false;
		const deleted = await deps.deleteArticle(articleId, userId);
		await deps.publishLinkDequeued({ url, userId });
		return deleted;
	};
}
