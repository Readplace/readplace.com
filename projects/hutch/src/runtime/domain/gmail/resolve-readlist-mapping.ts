import type {
	ForwardableSender,
	GmailHistoryImportCancelReason,
	GmailHistoryImportJob,
	GmailSenderStore,
} from "@packages/domain/gmail";
import type { InboxAddress, InboxAddressEntry } from "@packages/domain/inbox";
import type { ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";

export type MapSenderToReadlist = (input: {
	userId: UserId;
	sender: ForwardableSender;
	readlist: ReadlistSlug;
}) => Promise<{ destination: InboxAddress }>;

export function initMapSenderToReadlist(deps: {
	senders: Pick<GmailSenderStore, "findSender" | "mapSenderToAddress" | "addSenderToFilter">;
	getOrCreateReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddressEntry>;
	cancelGmailHistoryImports: (input: {
		userId: UserId;
		senderEmail: ForwardableSender | undefined;
		reason: GmailHistoryImportCancelReason;
	}) => Promise<GmailHistoryImportJob[]>;
}): MapSenderToReadlist {
	return async ({ userId, sender, readlist }) => {
		const [existing, address] = await Promise.all([
			deps.senders.findSender({ userId, senderEmail: sender }),
			deps.getOrCreateReadlistAddress({ userId, readlist }),
		]);
		const previous = existing?.mappedAddress;
		const remapped = previous !== undefined && previous !== address.address;
		if (previous !== address.address) {
			await deps.senders.mapSenderToAddress({ userId, senderEmail: sender, mappedAddress: address.address });
		}
		await deps.senders.addSenderToFilter({ userId, senderEmail: sender });
		if (remapped) {
			await deps.cancelGmailHistoryImports({ userId, senderEmail: sender, reason: "destination-changed" });
		}
		return { destination: address.address };
	};
}
