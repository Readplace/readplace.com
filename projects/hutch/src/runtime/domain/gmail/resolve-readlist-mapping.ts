import {
	type ForwardableSender,
	type GmailDeliveryMode,
	type GmailHistoryImportCancelReason,
	type GmailHistoryImportJob,
	type GmailSenderStore,
	pickerDeliveryMode,
} from "@packages/domain/gmail";
import type { InboxAddress, InboxAddressEntry } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";

export type MapSenderToReadlist = (input: {
	userId: UserId;
	sender: ForwardableSender;
	readlists: ReadlistSlug[];
	deliveryMode: GmailDeliveryMode;
}) => Promise<{ destinations: [InboxAddress, ...InboxAddress[]] }>;

export function initMapSenderToReadlist(deps: {
	senders: Pick<GmailSenderStore, "findSender" | "mapSenderToAddress" | "addSenderToFilter">;
	getOrCreateReadlistAddress: (input: { userId: UserId; readlist: ReadlistSlug }) => Promise<InboxAddressEntry>;
	cancelGmailHistoryImports: (input: {
		userId: UserId;
		senderEmail: ForwardableSender | undefined;
		reason: GmailHistoryImportCancelReason;
	}) => Promise<GmailHistoryImportJob[]>;
}): MapSenderToReadlist {
	return async ({ userId, sender, readlists, deliveryMode }) => {
		const customReadlists = [...new Set(readlists)].filter((readlist) => readlist !== DEFAULT_READLIST_SLUG);
		const [first = DEFAULT_READLIST_SLUG, ...remaining] = customReadlists;
		const [existing, primary, additional] = await Promise.all([
			deps.senders.findSender({ userId, senderEmail: sender }),
			deps.getOrCreateReadlistAddress({ userId, readlist: first }),
			Promise.all(remaining.map((readlist) => deps.getOrCreateReadlistAddress({ userId, readlist }))),
		]);
		const destinations: [InboxAddress, ...InboxAddress[]] = [primary.address, ...additional.map((entry) => entry.address)];
		const previous = existing?.mappedAddresses;
		const sameDestinations = previous !== undefined && previous.length === destinations.length &&
			previous.every((address) => destinations.includes(address));
		const unchanged = sameDestinations && pickerDeliveryMode(existing) === deliveryMode;
		if (!unchanged) {
			await deps.senders.mapSenderToAddress({ userId, senderEmail: sender, mappedAddresses: destinations, deliveryMode });
		}
		await deps.senders.addSenderToFilter({ userId, senderEmail: sender });
		if (previous !== undefined && !unchanged) {
			await deps.cancelGmailHistoryImports({ userId, senderEmail: sender, reason: "destination-changed" });
		}
		return { destinations: unchanged ? previous : destinations };
	};
}
