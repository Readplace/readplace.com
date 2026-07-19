import { z } from "zod";
import { EMAIL_FEATURE } from "@packages/web-shell";
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

/** Every built URL carries feature=email — the whole inbox surface 404s
 * without the flag, so a link that dropped it would dead-end. */
export function buildInboxEmailsUrl(state: { cursor?: InboxEmailsCursor }): string {
	const params = new URLSearchParams();
	params.set("feature", EMAIL_FEATURE);
	if (state.cursor !== undefined) {
		params.set(state.cursor.direction, state.cursor.receivedAtMessageId);
	}
	return `${INBOX_PATH}?${params.toString()}`;
}
