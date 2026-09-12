import { z } from "zod";
import { GmailAccountEmailSchema, parseGmailFrom } from "@packages/domain/gmail";
import type { DiscoveredGmailSender } from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { GetGmailAccessToken } from "@packages/provider-contracts/gmail-filters";
import type { GmailMailbox, GmailMailboxResult } from "@packages/provider-contracts/gmail-mailbox";

const ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me";
const PAGE_SIZE = 25;
const CONCURRENCY = 5;
const MessageReference = z.object({ id: z.string() });
const MessagesResponse = z.object({
	messages: z.array(MessageReference).optional(),
	nextPageToken: z.string().optional(),
});
const MetadataResponse = z.object({
	labelIds: z.array(z.string()).optional(),
	payload: z.object({
		headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
	}).optional(),
});
const HistoryResponse = z.object({
	history: z.array(z.object({
		messages: z.array(MessageReference).optional(),
	})).optional(),
	nextPageToken: z.string().optional(),
	historyId: z.string(),
});
const ProfileResponse = z.object({
	emailAddress: z.string().trim().toLowerCase().pipe(GmailAccountEmailSchema),
	historyId: z.string(),
});
const HistoryCursor = z.object({ pageToken: z.string().optional(), offset: z.number().int().nonnegative() });
const ErrorResponse = z.object({
	error: z.object({
		message: z.string(),
		errors: z.array(z.object({ reason: z.string() })).optional(),
		details: z.array(z.object({ reason: z.string().optional() })).optional(),
	}),
});

function encodeHistoryCursor(cursor: z.infer<typeof HistoryCursor>): string {
	return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function initGmailMailbox(deps: {
	accessToken: GetGmailAccessToken;
	fetch: typeof globalThis.fetch;
}): GmailMailbox {
	async function read<TSchema extends z.ZodType>(
		userId: UserId,
		url: string,
		schema: TSchema,
	): Promise<GmailMailboxResult<z.output<TSchema>>> {
		async function attempt(forceRefresh: boolean): Promise<GmailMailboxResult<z.output<TSchema>>> {
			const token = await deps.accessToken({ userId, forceRefresh });
			if (!token.ok) return token;
			const response = await deps.fetch(url, {
				method: "GET",
				headers: { Authorization: `Bearer ${token.value}` },
			});
			if (response.status === 401) {
				if (!forceRefresh) return attempt(true);
				return { ok: false, reason: "reauth-required" };
			}
			if (response.status === 429 || response.status >= 500) {
				return { ok: false, reason: "unavailable", status: response.status };
			}
			const body: unknown = await response.json().catch(() => undefined);
			if (response.ok) {
				const parsed = schema.safeParse(body);
				return parsed.success
					? { ok: true, value: parsed.data }
					: { ok: false, reason: "unavailable", status: response.status };
			}
			const parsedError = ErrorResponse.safeParse(body);
			const reasons = parsedError.success
				? [
					...(parsedError.data.error.errors ?? []).map((error) => error.reason),
					...(parsedError.data.error.details ?? []).map((error) => error.reason),
				]
				: [];
			if (response.status === 403) {
				if (reasons.some((reason) => reason === "rateLimitExceeded" || reason === "userRateLimitExceeded")) {
					return { ok: false, reason: "unavailable", status: response.status };
				}
				if (reasons.includes("insufficientPermissions") || reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
					if (!forceRefresh) return attempt(true);
					return { ok: false, reason: "metadata-permission-required" };
				}
			}
			return {
				ok: false,
				reason: "rejected",
				status: response.status,
				message: parsedError.success ? parsedError.data.error.message : response.statusText,
			};
		}
		return attempt(false);
	}

	async function findSenders(userId: UserId, messageIds: string[]): Promise<GmailMailboxResult<DiscoveredGmailSender[]>> {
		const senders = new Map<string, DiscoveredGmailSender>();
		for (let offset = 0; offset < messageIds.length; offset += CONCURRENCY) {
			const responses = await Promise.all(messageIds.slice(offset, offset + CONCURRENCY).map((id) => {
				const query = new URLSearchParams({
					format: "METADATA",
					metadataHeaders: "From",
					fields: "labelIds,payload(headers)",
				});
				return read(userId, `${ENDPOINT}/messages/${encodeURIComponent(id)}?${query}`, MetadataResponse);
			}));
			for (const result of responses) {
				if (!result.ok) {
					if (result.reason === "rejected" && result.status === 404) continue;
					return result;
				}
				const labels = result.value.labelIds ?? [];
				if (labels.some((label) => label === "SPAM" || label === "TRASH" || label === "DRAFT")) continue;
				if (labels.includes("SENT") && !labels.includes("INBOX")) continue;
				for (const header of result.value.payload?.headers ?? []) {
					if (header.name.toLowerCase() !== "from") continue;
					for (const sender of parseGmailFrom(header.value)) {
						const existing = senders.get(sender.email);
						if (existing?.name === undefined) senders.set(sender.email, sender);
					}
				}
			}
		}
		return { ok: true, value: [...senders.values()] };
	}

	return {
		findProfile: async ({ userId }) => {
			const result = await read(userId, `${ENDPOINT}/profile?fields=emailAddress,historyId`, ProfileResponse);
			if (!result.ok) return result;
			return { ok: true, value: { accountEmail: result.value.emailAddress, historyId: result.value.historyId } };
		},
		listMessageSenders: async ({ userId, pageToken }) => {
			const query = new URLSearchParams({
				maxResults: String(PAGE_SIZE),
				includeSpamTrash: "false",
				fields: "messages(id),nextPageToken",
			});
			if (pageToken !== undefined) query.set("pageToken", pageToken);
			const result = await read(userId, `${ENDPOINT}/messages?${query}`, MessagesResponse);
			if (!result.ok) return result;
			const messageIds = [...new Set((result.value.messages ?? []).map((message) => message.id))];
			const found = await findSenders(userId, messageIds);
			if (!found.ok) return found;
			return { ok: true, value: {
				senders: found.value,
				nextPageToken: result.value.nextPageToken,
				scannedMessages: messageIds.length,
			} };
		},
		listChangedMessageSenders: async ({ userId, startHistoryId, pageToken }) => {
			const cursor = pageToken === undefined
				? { pageToken: undefined, offset: 0 }
				: HistoryCursor.parse(JSON.parse(Buffer.from(pageToken, "base64url").toString()));
			const query = new URLSearchParams({
				maxResults: String(PAGE_SIZE),
				startHistoryId,
				fields: "history(messages(id)),nextPageToken,historyId",
			});
			for (const type of ["messageAdded", "labelAdded", "labelRemoved"]) query.append("historyTypes", type);
			if (cursor.pageToken !== undefined) query.set("pageToken", cursor.pageToken);
			const result = await read(userId, `${ENDPOINT}/history?${query}`, HistoryResponse);
			if (!result.ok) {
				if (result.reason === "rejected" && result.status === 404) return { ok: false, reason: "history-expired" };
				return result;
			}
			const messageIds = [...new Set((result.value.history ?? []).flatMap((history) =>
				(history.messages ?? []).map((message) => message.id)))];
			const batch = messageIds.slice(cursor.offset, cursor.offset + PAGE_SIZE);
			const found = await findSenders(userId, batch);
			if (!found.ok) return found;
			const offset = cursor.offset + batch.length;
			let nextPageToken: string | undefined;
			if (offset < messageIds.length) nextPageToken = encodeHistoryCursor({ pageToken: cursor.pageToken, offset });
			else if (result.value.nextPageToken !== undefined) nextPageToken = encodeHistoryCursor({ pageToken: result.value.nextPageToken, offset: 0 });
			return { ok: true, value: {
				senders: found.value,
				nextPageToken,
				scannedMessages: batch.length,
				historyId: result.value.historyId,
			} };
		},
	};
}
