import type { MarkLinkSavedWhileQueued } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { FindLinkQueueRowKeys } from "./find-link-queue-row-keys";

export type RecordLinkFact = (fact: { userId: UserId; url: string }) => Promise<string>;

export function initRecordQueuedLink(deps: {
	findLinkQueueRowKeys: FindLinkQueueRowKeys;
	markLinkSavedWhileQueued: MarkLinkSavedWhileQueued;
}): RecordLinkFact {
	return async ({ userId, url }) => {
		const [queueRowKey] = await deps.findLinkQueueRowKeys({ userId, url });
		if (queueRowKey === undefined) return "save not recorded: no-queue-row";
		await deps.markLinkSavedWhileQueued({ userId, url, queueRowKey });
		return "save accepted";
	};
}
