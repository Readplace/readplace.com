import type { GmailSenderStore } from "@packages/domain/gmail";
import type { InboxAddress, InboxAddressEntry } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { DeleteReadlistDefinition } from "@packages/provider-contracts/article-store";
import type { CancelGmailHistoryImports } from "./cancel-gmail-history-imports";

export function initMoveGmailMappingsOnReadlistDelete(deps: {
	deleteReadlistDefinition: DeleteReadlistDefinition;
	senders: GmailSenderStore;
	findReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddressEntry | undefined>;
	getOrCreateReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddressEntry>;
	retireReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddress | undefined>;
	cancelGmailHistoryImports: CancelGmailHistoryImports;
	publishRewriteGmailFilter: (input: { userId: UserId; reason: "readlist-deleted" }) => Promise<void>;
}): DeleteReadlistDefinition {
	return async (params) => {
		const { userId, slug } = params;
		const retiring = await deps.findReadlistAddress({ userId, readlist: slug });
		if (retiring === undefined) return deps.deleteReadlistDefinition(params);

		const mapped = (await deps.senders.listSendersByUserId(userId)).filter((sender) => sender.mappedAddress === retiring.address);
		if (mapped.length > 0) {
			const all = await deps.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG });
			for (const sender of mapped) {
				await deps.senders.mapSenderToAddress({ userId, senderEmail: sender.senderEmail, mappedAddress: all.address });
				await deps.cancelGmailHistoryImports({ userId, senderEmail: sender.senderEmail, reason: "destination-changed" });
			}
			await deps.publishRewriteGmailFilter({ userId, reason: "readlist-deleted" });
		}
		await deps.retireReadlistAddress({ userId, readlist: slug });
		return deps.deleteReadlistDefinition(params);
	};
}
