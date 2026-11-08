import type { GmailConnectionStore, GmailDiscoveryStore } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailMonitoringStore } from "@packages/provider-contracts/gmail-monitoring";
import type { DisconnectGmail, DisconnectGmailOutcome } from "./disconnect-gmail";

export type DisconnectGmailWhenRequestedOutcome =
	| DisconnectGmailOutcome
	| { ok: false; reason: "not-requested" };

export type DisconnectGmailWhenRequested = (input: {
	userId: UserId;
}) => Promise<DisconnectGmailWhenRequestedOutcome>;

export function initDisconnectGmailWhenRequested(deps: {
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	discovery: Pick<GmailDiscoveryStore, "deleteDiscoveryByUserId">;
	monitoring: Pick<GmailMonitoringStore, "deleteAllByUserId">;
	disconnectGmail: DisconnectGmail;
}): DisconnectGmailWhenRequested {
	const { connections, discovery, monitoring, disconnectGmail } = deps;

	return async ({ userId }) => {
		const connection = await connections.findConnectionByUserId(userId);
		if (connection === undefined) {
			await monitoring.deleteAllByUserId(userId);
			await discovery.deleteDiscoveryByUserId(userId);
			return { ok: false, reason: "not-connected" };
		}
		if (connection.disconnectRequestedAt === undefined) return { ok: false, reason: "not-requested" };
		return disconnectGmail({ userId });
	};
}
