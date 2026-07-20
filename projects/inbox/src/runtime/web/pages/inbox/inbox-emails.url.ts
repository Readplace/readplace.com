import { z } from "zod";
import type { InboxEmailsCursor } from "@packages/domain/inbox";

export const INBOX_PATH = "/inbox";

export const INBOX_EMAILS_PAGE_SIZE = 10;

const CursorValueSchema = z
	.string()
	.min(1)
	.refine((value) => Buffer.byteLength(value, "utf8") <= 1024)
	.optional()
	.catch(undefined);

const InboxEmailsQuerySchema = z
	.object({ older: CursorValueSchema, newer: CursorValueSchema })
	.passthrough();

export function parseInboxEmailsUrl(query: Record<string, unknown>): {
	cursor: InboxEmailsCursor | undefined;
} {
	const parsed = InboxEmailsQuerySchema.parse(query);
	if (parsed.older !== undefined) {
		return { cursor: { direction: "older", receivedAtMessageId: parsed.older } };
	}
	if (parsed.newer !== undefined) {
		return { cursor: { direction: "newer", receivedAtMessageId: parsed.newer } };
	}
	return { cursor: undefined };
}

export function buildInboxEmailsUrl(state: { cursor?: InboxEmailsCursor }): string {
	if (state.cursor === undefined) {
		return INBOX_PATH;
	}
	const params = new URLSearchParams();
	params.set(state.cursor.direction, state.cursor.receivedAtMessageId);
	return `${INBOX_PATH}?${params.toString()}`;
}
