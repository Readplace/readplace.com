import { z } from "zod";

export const GMAIL_FILTER_QUERY_MAX_LENGTH = 1024;

const SENDER_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const ForwardableSenderSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(SENDER_PATTERN)
	.refine((sender) => !sender.startsWith("-"))
	.brand<"ForwardableSender">();

export type ForwardableSender = z.infer<typeof ForwardableSenderSchema>;

export type ForwardingFilterQuery =
	| { ok: true; query: string; senders: ForwardableSender[] }
	| { ok: false; reason: "no-senders" }
	| { ok: false; reason: "too-long"; length: number; senderCount: number };

export interface ForwardingFilterQueryResult {
	query: ForwardingFilterQuery;
	refused: string[];
}

export function parseForwardableSender(candidate: string): ForwardableSender | undefined {
	const parsed = ForwardableSenderSchema.safeParse(candidate);
	return parsed.success ? parsed.data : undefined;
}

export function buildForwardingFilterQuery(input: {
	senders: readonly string[];
}): ForwardingFilterQueryResult {
	const refused: string[] = [];
	const accepted = new Set<ForwardableSender>();
	for (const candidate of input.senders) {
		const sender = parseForwardableSender(candidate);
		if (sender === undefined) refused.push(candidate);
		else accepted.add(sender);
	}
	const senders = [...accepted].sort();
	if (senders.length === 0) return { query: { ok: false, reason: "no-senders" }, refused };
	const query = `from:(${senders.join(" OR ")})`;
	if (query.length > GMAIL_FILTER_QUERY_MAX_LENGTH) {
		const tooLong = {
			ok: false,
			reason: "too-long",
			length: query.length,
			senderCount: senders.length,
		} as const;
		return { query: tooLong, refused };
	}
	return { query: { ok: true, query, senders }, refused };
}
