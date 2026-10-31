import type { ForwardableSender, GmailAccountEmail, GmailMappingStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";

export type FindMarkImportedSince = (input: {
	userId: UserId;
	accountEmail: GmailAccountEmail;
	senderEmail: ForwardableSender;
}) => Promise<string | undefined>;

export function initFindMarkImportedSince(deps: { findMapping: GmailMappingStore["findMapping"] }): FindMarkImportedSince {
	return async (input) => (await deps.findMapping(input))?.markImportedAt;
}
