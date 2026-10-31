import type { ForwardableSender, GmailAccountEmail, GmailMapping } from "@packages/domain/gmail";
import { type InboxAddress, isLiveAddress } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailIntegrationDependencies } from "./gmail-integration.types";

export interface GmailMappingRef {
	userId: UserId;
	accountEmail: GmailAccountEmail;
	senderEmail: ForwardableSender;
}

export interface GmailMarkActions {
	readlistDestinations: (input: { userId: UserId; row: GmailMapping | undefined }) => Promise<[InboxAddress, ...InboxAddress[]] | undefined>;
	mappedNewsletter: (ref: GmailMappingRef) => Promise<GmailMapping | undefined>;
	turnOnMapped: (ref: GmailMappingRef) => Promise<void>;
}

export function initGmailMarkActions(deps: {
	gmail: Pick<GmailIntegrationDependencies, "findInboxAddress" | "gmailMappingStore">;
}): GmailMarkActions {
	const { gmail } = deps;

	const readlistDestinations: GmailMarkActions["readlistDestinations"] = async (input) => {
		const destinations = input.row?.addedToFilterAt === undefined ? undefined : input.row.mappedAddresses;
		if (destinations === undefined) return undefined;
		const entries = await Promise.all(destinations.map((address) => gmail.findInboxAddress(address)));
		return entries.every((entry) => entry !== undefined && entry.userId === input.userId && isLiveAddress(entry)) ? destinations : undefined;
	};

	const mappedNewsletter: GmailMarkActions["mappedNewsletter"] = async (ref) => {
		const row = await gmail.gmailMappingStore.findMapping(ref);
		return (await readlistDestinations({ userId: ref.userId, row })) === undefined ? undefined : row;
	};

	return {
		readlistDestinations,
		mappedNewsletter,
		turnOnMapped: async (ref) => {
			if ((await mappedNewsletter(ref)) !== undefined) await gmail.gmailMappingStore.setMarkImported(ref);
		},
	};
}
