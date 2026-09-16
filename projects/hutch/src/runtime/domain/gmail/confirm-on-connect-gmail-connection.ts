import assert from "node:assert";
import type { GmailConnectionStore } from "@packages/domain/gmail";
import type { InboxAddressStore } from "@packages/domain/inbox";

export function initConfirmOnConnectGmailConnection(deps: {
	connections: GmailConnectionStore;
	addresses: InboxAddressStore;
}): GmailConnectionStore {
	const { connections, addresses } = deps;

	return {
		...connections,
		createConnection: async (input) => {
			const connection = await connections.createConnection(input);
			await connections.markForwardingConfirmed({ userId: connection.userId });
			await addresses.markGmailForwardingConfirmed({ userId: connection.userId, address: connection.gatewayAddress });
			const confirmed = await connections.findConnectionByUserId(connection.userId);
			assert(confirmed, "the just-created connection is readable");
			return confirmed;
		},
	};
}
