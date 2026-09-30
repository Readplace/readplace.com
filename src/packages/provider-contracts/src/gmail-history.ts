import type {
	ForwardableSender,
	GmailHistoryImportWindow,
	GmailMessageId,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "./gmail-filters";

export type GmailHistoryResult<T> = GmailApiResult<T> | { ok: false; reason: "readonly-permission-required" };

export type GetGmailReadonlyAccessToken = (input: {
	userId: UserId;
	forceRefresh: boolean;
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
	}) => Promise<GmailHistoryResult<{ messageIds: GmailMessageId[]; nextPageToken: string | undefined }>>;
	fetchRawMessage: (input: {
		userId: UserId;
		messageId: GmailMessageId;
	}) => Promise<GmailHistoryResult<GmailRawMessage | { notFound: true }>>;
}

export type PutGmailImportRaw = (input: { key: string; raw: Buffer }) => Promise<void>;
