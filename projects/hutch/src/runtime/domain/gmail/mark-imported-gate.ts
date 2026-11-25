import type { ForwardableSender, GmailAccountEmail, GmailMappingStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

export type IsGmailSenderMapped = (input: {
	userId: UserId;
	accountEmail: GmailAccountEmail;
	senderEmail: ForwardableSender;
}) => Promise<boolean>;

export function initIsGmailSenderMapped(deps: { findMapping: GmailMappingStore["findMapping"] }): IsGmailSenderMapped {
	return async (input) => {
		const mapping = await deps.findMapping(input);
		return mapping?.addedToFilterAt !== undefined && mapping.mappedAddresses !== undefined;
	};
}
