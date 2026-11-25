import type { GmailMapping } from "@packages/domain/gmail";
import { type InboxAddress, isLiveAddress } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";

export function initGmailImportDestinations(deps: Pick<GmailIntegrationDependencies, "findInboxAddress">) {
	return async (input: { userId: UserId; row: GmailMapping | undefined }): Promise<[InboxAddress, ...InboxAddress[]] | undefined> => {
		const destinations = input.row?.addedToFilterAt === undefined ? undefined : input.row.mappedAddresses;
		if (destinations === undefined) return undefined;
		const entries = await Promise.all(destinations.map((address) => deps.findInboxAddress(address)));
		return entries.every((entry) => entry !== undefined && entry.userId === input.userId && isLiveAddress(entry)) ? destinations : undefined;
	};
}
