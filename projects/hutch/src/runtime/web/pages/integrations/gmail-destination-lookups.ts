import type { GmailConnection } from "@packages/domain/gmail";
import { type InboxAddress, InboxAddressSchema } from "@packages/domain/inbox";

export function destinationLookups(input: { connection: GmailConnection; mapped: readonly InboxAddress[] }): InboxAddress[] {
	const addresses = [...input.mapped];
	const filterError = input.connection.lastFilterError;
	if (filterError?.code === "query-too-long" && filterError.forwardTo !== input.connection.gatewayAddress) {
		addresses.push(InboxAddressSchema.parse(filterError.forwardTo));
	}
	return [...new Set(addresses)];
}
