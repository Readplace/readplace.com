import type { InboxSavedLinkStore, MarkLinkSavedWhileQueued } from "@packages/domain/inbox";
import type { IsAccountLive } from "@packages/provider-contracts/auth";
import type { FindLinkQueueRowKeys } from "./find-link-queue-row-keys";
import type { RecordLinkFact } from "./record-queued-link";

export function initRecordFailedLink(deps: {
	findLinkQueueRowKeys: FindLinkQueueRowKeys;
	markLinkSavedWhileQueued: MarkLinkSavedWhileQueued;
	isAccountLive: IsAccountLive;
	markLinkSaveFailed: InboxSavedLinkStore["markLinkSaveFailed"];
}): RecordLinkFact {
	return async ({ userId, url }) => {
		const [queueRowKey] = await deps.findLinkQueueRowKeys({ userId, url });
		if (queueRowKey !== undefined) {
			await deps.markLinkSavedWhileQueued({ userId, url, queueRowKey });
			return "failure superseded: link-queued";
		}
		if (!(await deps.isAccountLive(userId))) return "failure not recorded: account-closed";
		await deps.markLinkSaveFailed({ userId, url });
		return "save failed";
	};
}
