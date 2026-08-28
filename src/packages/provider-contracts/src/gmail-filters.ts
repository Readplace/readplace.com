import type { UserId } from "@packages/domain/user";

export type GmailApiFailure =
	| { reason: "reauth-required" }
	| { reason: "rejected"; status: number; message: string }
	| { reason: "unavailable"; status: number };

export type GmailApiResult<TValue> = { ok: true; value: TValue } | ({ ok: false } & GmailApiFailure);

export type GmailAccessTokenResult = GmailApiResult<string>;

export type GetGmailAccessToken = (input: {
	userId: UserId;
	forceRefresh: boolean;
}) => Promise<GmailAccessTokenResult>;

export interface GmailFilter {
	id: string;
	query: string | undefined;
	forwardTo: string | undefined;
}

export interface GmailFilters {
	listFilters: (input: { userId: UserId }) => Promise<GmailApiResult<GmailFilter[]>>;
	createForwardingFilter: (input: {
		userId: UserId;
		query: string;
		forwardTo: string;
	}) => Promise<GmailApiResult<GmailFilter>>;
	getFilter: (input: {
		userId: UserId;
		filterId: string;
	}) => Promise<GmailApiResult<GmailFilter>>;
	deleteFilter: (input: { userId: UserId; filterId: string }) => Promise<GmailApiResult<undefined>>;
}
