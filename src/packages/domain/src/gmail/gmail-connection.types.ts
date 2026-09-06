import type { InboxAddress } from "../inbox/inbox-address.schema";
import type { UserId } from "../user";

export type GmailRevokedReason = "invalid-grant" | "scope-not-granted";

export interface GmailFilterError {
	code: GmailFilterErrorCode;
	message: string;
	at: string;
}

export type GmailFilterErrorCode = "query-too-long" | "rejected";

export interface GmailConnection {
	userId: UserId;
	gatewayAddress: InboxAddress;
	connectedAt: string;
	forwardingConfirmedAt: string | undefined;
	filterId: string | undefined;
	filterQuery: string | undefined;
	filterSenderCount: number | undefined;
	filterUpdatedAt: string | undefined;
	lastFilterError: GmailFilterError | undefined;
	revokedAt: string | undefined;
	revokedReason: GmailRevokedReason | undefined;
}

export interface GmailConnectionStore {
	createConnection: (input: {
		userId: UserId;
		gatewayAddress: InboxAddress;
	}) => Promise<GmailConnection>;
	findConnectionByUserId: (
		userId: UserId,
	) => Promise<GmailConnection | undefined>;
	markForwardingConfirmed: (input: { userId: UserId }) => Promise<void>;
	clearForwardingConfirmed: (input: { userId: UserId }) => Promise<void>;
	recordFilter: (input: {
		userId: UserId;
		filterId: string;
		filterQuery: string;
		filterSenderCount: number;
	}) => Promise<void>;
	clearFilter: (input: { userId: UserId }) => Promise<void>;
	recordFilterError: (input: {
		userId: UserId;
		error: GmailFilterError;
	}) => Promise<void>;
	markRevoked: (input: {
		userId: UserId;
		reason: GmailRevokedReason;
	}) => Promise<void>;
	clearRevoked: (input: { userId: UserId }) => Promise<void>;
	deleteConnection: (userId: UserId) => Promise<void>;
	countConnected: () => Promise<number>;
}
