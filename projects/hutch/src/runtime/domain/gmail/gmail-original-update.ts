import {
	GMAIL_IMPORTED_LABEL_NAME,
	type GmailMessageId,
	type GmailMessageOrigin,
	type GmailMessageUpdateFailureReason,
	parseGmailFrom,
} from "@packages/domain/gmail";
import { MessageIdSchema, normalizeMessageId } from "@packages/domain/inbox";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { OpenedGmailMailbox } from "@packages/provider-contracts/gmail-message-update";

const UNREAD_LABEL = "UNREAD";

export class GmailUnavailableError extends Error {}

export type GmailOriginalUpdateFailure =
	| { kind: "failed"; reason: GmailMessageUpdateFailureReason }
	| { kind: "reauth-required" };

export type MarkOriginalOutcome = { kind: "marked" } | GmailOriginalUpdateFailure;

type Step<T> = { ok: true; value: T } | { ok: false; outcome: GmailOriginalUpdateFailure };

function settle<T>(result: GmailApiResult<T>): Step<T> {
	if (result.ok) return { ok: true, value: result.value };
	if (result.reason === "unavailable") throw new GmailUnavailableError(`Gmail unavailable (${result.status})`);
	if (result.reason === "reauth-required") return { ok: false, outcome: { kind: "reauth-required" } };
	return { ok: false, outcome: { kind: "failed", reason: "gmail-rejected" } };
}

async function locateOriginal(mailbox: OpenedGmailMailbox, origin: GmailMessageOrigin): Promise<Step<GmailMessageId>> {
	if (origin.kind === "history") {
		const found = settle(await mailbox.findMessage({ messageId: origin.gmailMessageId }));
		if (!found.ok) return found;
		return found.value.found
			? { ok: true, value: origin.gmailMessageId }
			: { ok: false, outcome: { kind: "failed", reason: "original-not-found" } };
	}
	const searched = settle(await mailbox.searchByRfcMessageId({ rfcMessageId: origin.rfcMessageId, senderEmail: origin.senderEmail }));
	if (!searched.ok) return searched;
	const matches = searched.value.filter((candidate) => {
		const header = MessageIdSchema.safeParse(candidate.messageIdHeader);
		const senders = parseGmailFrom(candidate.fromHeader ?? "");
		return (
			header.success &&
			normalizeMessageId(header.data) === origin.rfcMessageId &&
			senders.length === 1 &&
			senders[0]?.email === origin.senderEmail
		);
	});
	const [match, ...others] = matches;
	if (match === undefined) return { ok: false, outcome: { kind: "failed", reason: "original-not-found" } };
	if (others.length > 0) return { ok: false, outcome: { kind: "failed", reason: "ambiguous-original" } };
	return { ok: true, value: match.id };
}

export async function importedLabelId(mailbox: OpenedGmailMailbox): Promise<Step<string>> {
	const existing = settle(await mailbox.findLabelId({ name: GMAIL_IMPORTED_LABEL_NAME }));
	if (!existing.ok) return existing;
	if (existing.value !== undefined) return { ok: true, value: existing.value };
	const created = settle(await mailbox.createLabel({ name: GMAIL_IMPORTED_LABEL_NAME }));
	if (!created.ok) return created;
	if ("created" in created.value) return { ok: true, value: created.value.created };
	const raced = settle(await mailbox.findLabelId({ name: GMAIL_IMPORTED_LABEL_NAME }));
	if (!raced.ok) return raced;
	if (raced.value === undefined) throw new GmailUnavailableError("the imported label was reported to exist but is not listed");
	return { ok: true, value: raced.value };
}

export async function markOriginal(input: {
	mailbox: OpenedGmailMailbox;
	origin: GmailMessageOrigin;
	labelId: string;
}): Promise<MarkOriginalOutcome> {
	const { mailbox, origin, labelId } = input;
	const original = await locateOriginal(mailbox, origin);
	if (!original.ok) return original.outcome;
	const modified = settle(await mailbox.modifyMessage({ messageId: original.value, addLabelIds: [labelId], removeLabelIds: [UNREAD_LABEL] }));
	if (!modified.ok) return modified.outcome;
	return { kind: "marked" };
}
