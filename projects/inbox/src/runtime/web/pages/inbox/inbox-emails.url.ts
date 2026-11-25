import { z } from "zod";
import { INBOX_PATH, type InboxEmailsCursor } from "@packages/domain/inbox";

export const INBOX_EMAILS_PAGE_SIZE = 10;

const CursorValueSchema = z
	.string()
	.min(1)
	.refine((value) => Buffer.byteLength(value, "utf8") <= 1024)
	.optional()
	.catch(undefined);

const InboxEmailsQuerySchema = z.looseObject({
	sender: CursorValueSchema,
	older: CursorValueSchema,
	newer: CursorValueSchema,
});

export function parseInboxEmailsUrl(query: Record<string, unknown>): {
	cursor: InboxEmailsCursor | undefined;
	sender?: string;
} {
	const parsed = InboxEmailsQuerySchema.parse(query);
	if (parsed.older !== undefined) {
		return { sender: parsed.sender, cursor: { direction: "older", receivedAtMessageId: parsed.older } };
	}
	if (parsed.newer !== undefined) {
		return { sender: parsed.sender, cursor: { direction: "newer", receivedAtMessageId: parsed.newer } };
	}
	return { sender: parsed.sender, cursor: undefined };
}

export function buildInboxEmailsUrl(state: { cursor?: InboxEmailsCursor; sender?: string }): string {
	const params = new URLSearchParams();
	if (state.sender !== undefined) params.set("sender", state.sender);
	if (state.cursor !== undefined) params.set(state.cursor.direction, state.cursor.receivedAtMessageId);
	if (params.size === 0) return INBOX_PATH;
	return `${INBOX_PATH}?${params.toString()}`;
}
