import assert from "node:assert";
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

		const mapped = (await deps.senders.listSendersByUserId(userId)).filter((sender) => sender.mappedAddresses?.includes(retiring.address));
		if (mapped.length > 0) {
			for (const sender of mapped) {
				assert(sender.mappedAddresses, "a sender selected for a readlist move must have destinations");
				const remaining = sender.mappedAddresses.filter((address) => address !== retiring.address);
				const [first, ...additional] = remaining;
				const primary = first === undefined
					? (await deps.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG })).address
					: first;
				await deps.senders.mapSenderToAddress({ userId, senderEmail: sender.senderEmail, mappedAddresses: [primary, ...additional] });
				await deps.cancelGmailHistoryImports({ userId, senderEmail: sender.senderEmail, reason: "destination-changed" });
			}
			await deps.publishRewriteGmailFilter({ userId, reason: "readlist-deleted" });
		}
		await deps.retireReadlistAddress({ userId, readlist: slug });
		return deps.deleteReadlistDefinition(params);
	};
}
