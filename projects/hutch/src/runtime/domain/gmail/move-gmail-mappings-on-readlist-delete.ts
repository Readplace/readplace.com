import assert from "node:assert";
import { type GmailConnectionStore, type GmailMappingStore, resolveGmailDeliveryMode } from "@packages/domain/gmail";
import type { InboxAddress, InboxAddressEntry } from "@packages/domain/inbox";
import { DEFAULT_READLIST_SLUG, type ReadlistSlug } from "@packages/domain/readlist";
import type { UserId } from "@packages/domain/user";
import type { DeleteReadlistDefinition } from "@packages/provider-contracts/article-store";
import type { CancelGmailHistoryImports } from "./cancel-gmail-history-imports";

export function initMoveGmailMappingsOnReadlistDelete(deps: {
	deleteReadlistDefinition: DeleteReadlistDefinition;
	mappings: Pick<GmailMappingStore, "listMappingsByUserId" | "mapSenderToAddress">;
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
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

		const mapped = (await deps.mappings.listMappingsByUserId(userId)).filter((mapping) => mapping.mappedAddresses?.includes(retiring.address));
		if (mapped.length > 0) {
			for (const mapping of mapped) {
				assert(mapping.mappedAddresses, "a sender selected for a readlist move must have destinations");
				const remaining = mapping.mappedAddresses.filter((address) => address !== retiring.address);
				const [first, ...additional] = remaining;
				const primary = first === undefined
					? (await deps.getOrCreateReadlistAddress({ userId, readlist: DEFAULT_READLIST_SLUG })).address
					: first;
				await deps.mappings.mapSenderToAddress({
					userId,
					accountEmail: mapping.accountEmail,
					senderEmail: mapping.senderEmail,
					mappedAddresses: [primary, ...additional],
					deliveryMode: resolveGmailDeliveryMode(mapping),
				});
			}
			const connection = await deps.connections.findConnectionByUserId(userId);
			const connected = mapped.filter((mapping) => mapping.accountEmail === connection?.accountEmail);
			for (const mapping of connected) {
				await deps.cancelGmailHistoryImports({ userId, senderEmail: mapping.senderEmail, reason: "destination-changed" });
			}
			if (connected.length > 0) await deps.publishRewriteGmailFilter({ userId, reason: "readlist-deleted" });
		}
		await deps.retireReadlistAddress({ userId, readlist: slug });
		return deps.deleteReadlistDefinition(params);
	};
}
