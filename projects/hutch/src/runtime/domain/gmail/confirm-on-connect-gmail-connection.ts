import assert from "node:assert";
import type { GmailConnectionStore } from "@packages/domain/gmail";

export function initConfirmOnConnectGmailConnection(deps: {
	connections: GmailConnectionStore;
}): GmailConnectionStore {
	const { connections } = deps;

	return {
		...connections,
		createConnection: async (input) => {
			const connection = await connections.createConnection(input);
			await connections.markForwardingConfirmed({ userId: connection.userId });
			const confirmed = await connections.findConnectionByUserId(connection.userId);
			assert(confirmed, "the just-created connection is readable");
			return confirmed;
		},
	};
}
