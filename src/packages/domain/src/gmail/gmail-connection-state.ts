import type { GmailConnection } from "./gmail-connection.types";

export type GmailConnectionState =
	| "disconnected"
	| "revoked"
	| "filter-failed"
	| "awaiting-confirmation"
	| "ready-to-filter"
	| "filtering";

export function gmailConnectionState(connection: GmailConnection | undefined): GmailConnectionState {
	if (connection === undefined) return "disconnected";
	if (connection.revokedAt !== undefined) return "revoked";
	if (connection.lastFilterError !== undefined) return "filter-failed";
	if (connection.forwardingConfirmedAt === undefined) return "awaiting-confirmation";
	if (connection.filterId === undefined) return "ready-to-filter";
	return "filtering";
}
