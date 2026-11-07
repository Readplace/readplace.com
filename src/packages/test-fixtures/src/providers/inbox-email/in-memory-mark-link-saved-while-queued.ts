import assert from "node:assert";
import type { MarkLinkSavedWhileQueued } from "@packages/domain/inbox";
import type { QueueRowKey } from "@packages/provider-contracts/article-store";
import type { InMemoryInboxSavedLink } from "./in-memory-inbox-saved-link";

export function initInMemoryMarkLinkSavedWhileQueued(deps: {
	hasQueueRow: (key: QueueRowKey) => boolean;
	inboxSavedLinkStore: InMemoryInboxSavedLink;
}): MarkLinkSavedWhileQueued {
	return async ({ userId, url, queueRowKey }) => {
		assert(deps.hasQueueRow(queueRowKey), "ConditionalCheckFailed: the queue row is gone");
		await deps.inboxSavedLinkStore.markLinkSaved({ userId, url });
	};
}
