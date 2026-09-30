import {
	type ForwardableSender,
	GMAIL_HISTORY_IMPORT_PAGE_SIZE,
	type GmailHistoryImportWindow,
	type GmailMessageId,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GmailHistory, GmailHistoryResult } from "@packages/provider-contracts/gmail-history";

export interface InMemoryGmailMessage {
	userId: UserId;
	sender: ForwardableSender;
	messageId: GmailMessageId;
	raw: Buffer;
	internalDate: string;
	labelIds: string[];
}

export type GmailHistoryFailure = Exclude<GmailHistoryResult<never>, { ok: true }>;

const EXCLUDED_LABELS = new Set(["SPAM", "TRASH"]);

function listable(message: InMemoryGmailMessage, input: { userId: UserId; sender: ForwardableSender; window: GmailHistoryImportWindow }) {
	return (
		message.userId === input.userId &&
		message.sender === input.sender &&
		message.labelIds.includes("UNREAD") &&
		!message.labelIds.some((label) => EXCLUDED_LABELS.has(label)) &&
		message.internalDate >= input.window.start &&
		message.internalDate < input.window.end
	);
}

export function initInMemoryGmailHistory() {
	const messages = new Map<GmailMessageId, InMemoryGmailMessage>();
	const listRequests: { sender: ForwardableSender; window: GmailHistoryImportWindow; pageToken: string | undefined }[] = [];
	const failures: { listUnreadMessageIds: GmailHistoryFailure[]; fetchRawMessage: GmailHistoryFailure[] } = {
		listUnreadMessageIds: [],
		fetchRawMessage: [],
	};

	const history: GmailHistory = {
		listUnreadMessageIds: async (input) => {
			listRequests.push({ sender: input.sender, window: input.window, pageToken: input.pageToken });
			const failure = failures.listUnreadMessageIds.shift();
			if (failure !== undefined) return failure;
			const matching = [...messages.values()]
				.filter((message) => listable(message, input))
				.sort((a, b) => b.internalDate.localeCompare(a.internalDate));
			const offset = Number(input.pageToken ?? "0");
			const end = offset + GMAIL_HISTORY_IMPORT_PAGE_SIZE;
			return {
				ok: true,
				value: {
					messageIds: matching.slice(offset, end).map((message) => message.messageId),
					nextPageToken: end < matching.length ? String(end) : undefined,
				},
			};
		},
		fetchRawMessage: async ({ userId, messageId }) => {
			const failure = failures.fetchRawMessage.shift();
			if (failure !== undefined) return failure;
			const message = messages.get(messageId);
			if (message === undefined || message.userId !== userId) return { ok: true, value: { notFound: true } };
			return { ok: true, value: { raw: message.raw, internalDate: message.internalDate, labelIds: message.labelIds } };
		},
	};

	return {
		history,
		listRequests,
		addMessage: (message: InMemoryGmailMessage) => {
			messages.set(message.messageId, message);
		},
		failNext: (input: { method: keyof GmailHistory; failure: GmailHistoryFailure }) => {
			failures[input.method].push(input.failure);
		},
	};
}
