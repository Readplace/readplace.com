import type {
	ForwardableSender,
	GmailHistoryImportWindow,
	GmailMessageId,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "./gmail-filters";

export type GmailHistoryResult<T> = GmailApiResult<T> | { ok: false; reason: "readonly-permission-required" };

export type GmailHttpOperation = "messages.list" | "messages.get" | "oauth.refresh";

export type GmailHttpEndpoint =
	| "gmail.messages.list"
	| "gmail.messages.get"
	| "oauth.token"
	| "other-expected-origin"
	| "unexpected-origin";

export type GmailHttpRequestSettings =
	| { operation: "messages.list"; fieldMask: string; pageSize: number; includeSpamTrash: boolean; pageTokenPresent: boolean }
	| { operation: "messages.get"; fieldMask: string; format: string }
	| { operation: "oauth.refresh"; forceRefresh: boolean };

export type GmailHttpClassification =
	| "ok"
	| "not-found"
	| "token-refresh-retry"
	| "reauth-required"
	| "readonly-permission-required"
	| "unavailable"
	| "rejected"
	| "transport-failed"
	| "exception";

export interface GmailHttpBodyRead {
	source: "response" | "clone";
	outcome: "valid" | "json-decode-failed" | "body-read-failed" | "schema-rejected";
	measuredBytes: number | undefined;
	errorName: string | undefined;
	fields: Record<string, number | boolean>;
}

export interface GmailHttpResponseHeaders {
	contentType: string | undefined;
	declaredContentLength: number | undefined;
	contentEncoding: string | undefined;
	date: string | undefined;
	retryAfter: string | undefined;
	googRequestId: string | undefined;
	guploaderUploadId: string | undefined;
	cloudTraceContext: string | undefined;
}

export interface GmailHttpResponseEvidence {
	status: number;
	redirected: boolean;
	finalEndpoint: GmailHttpEndpoint;
	finalOriginExpected: boolean;
	bodyNull: boolean;
	headers: GmailHttpResponseHeaders;
	bodyReads: GmailHttpBodyRead[];
}

export interface GmailHttpAttempt {
	operation: GmailHttpOperation;
	attempt: number;
	request: GmailHttpRequestSettings;
	requestedEndpoint: GmailHttpEndpoint;
	durationMs: number;
	response: GmailHttpResponseEvidence | undefined;
	transportFailure: { errorName: string; errorCode: string | undefined } | undefined;
	classification: GmailHttpClassification;
}

export type ObserveGmailHttpAttempt = (attempt: GmailHttpAttempt) => void;

export type GetGmailReadonlyAccessToken = (input: {
	userId: UserId;
	forceRefresh: boolean;
	observe: ObserveGmailHttpAttempt;
}) => Promise<GmailHistoryResult<string>>;

export interface GmailRawMessage {
	raw: Buffer;
	internalDate: string;
	labelIds: string[];
}

export interface GmailHistory {
	listUnreadMessageIds: (input: {
		userId: UserId;
		sender: ForwardableSender;
		window: GmailHistoryImportWindow;
		pageToken: string | undefined;
		observe: ObserveGmailHttpAttempt;
	}) => Promise<GmailHistoryResult<{ messageIds: GmailMessageId[]; nextPageToken: string | undefined }>>;
	fetchRawMessage: (input: {
		userId: UserId;
		messageId: GmailMessageId;
		observe: ObserveGmailHttpAttempt;
	}) => Promise<GmailHistoryResult<GmailRawMessage | { notFound: true }>>;
}

export type PutGmailImportRaw = (input: { key: string; raw: Buffer }) => Promise<void>;
