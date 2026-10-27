import {
	GMAIL_IMPORTED_LABEL_NAME,
	type GmailConnectionStore,
	type GmailMessageId,
	type GmailMessageOrigin,
	type GmailMessageUpdateFailureReason,
	type GmailMessageUpdateStore,
	parseGmailFrom,
	sameGmailAccount,
} from "@packages/domain/gmail";
import { MessageIdSchema, normalizeMessageId } from "@packages/domain/inbox";
import type { UserId } from "@packages/domain/user";
import type { GmailApiResult } from "@packages/provider-contracts/gmail-filters";
import type { OpenedGmailMailbox, OpenGmailMailboxForUpdate } from "@packages/provider-contracts/gmail-message-update";

const UNREAD_LABEL = "UNREAD";

export type MarkGmailEmailImportedOutcome =
	| { kind: "marked" | "already-marked" }
	| { kind: "deferred"; reason: "permission-required" | "account-unavailable" }
	| { kind: "failed" | "already-failed"; reason: GmailMessageUpdateFailureReason };

export type MarkGmailEmailImported = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	origin: GmailMessageOrigin;
}) => Promise<MarkGmailEmailImportedOutcome>;

class GmailUnavailableError extends Error {}

type Step<T> = { ok: true; value: T } | { ok: false; outcome: MarkGmailEmailImportedOutcome };

function settle<T>(result: GmailApiResult<T>): Step<T> {
	if (result.ok) return { ok: true, value: result.value };
	if (result.reason === "unavailable") throw new GmailUnavailableError(`Gmail unavailable (${result.status})`);
	if (result.reason === "reauth-required") return { ok: false, outcome: { kind: "deferred", reason: "account-unavailable" } };
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

async function importedLabelId(mailbox: OpenedGmailMailbox): Promise<Step<string>> {
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

export function initMarkGmailEmailImported(deps: {
	updates: GmailMessageUpdateStore;
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	openMailbox: OpenGmailMailboxForUpdate;
	now: () => Date;
}): MarkGmailEmailImported {
	const { updates } = deps;

	return async ({ userId, receivedAtMessageId, origin }) => {
		const recorded = await updates.recordPending({ userId, receivedAtMessageId, origin, now: deps.now() });
		if (recorded.status === "completed") return { kind: "already-marked" };
		if (recorded.status === "failed") return { kind: "already-failed", reason: recorded.failureReason };

		const connection = await deps.connections.findConnectionByUserId(userId);
		if (
			connection?.accountEmail === undefined ||
			connection.disconnectRequestedAt !== undefined ||
			connection.revokedAt !== undefined ||
			!sameGmailAccount(connection.accountEmail, origin.accountEmail)
		) {
			return { kind: "deferred", reason: "account-unavailable" };
		}

		const opened = await deps.openMailbox({ userId, accountEmail: origin.accountEmail });
		if (!opened.ok) {
			if (opened.reason === "unavailable") throw new GmailUnavailableError(`Gmail unavailable (${opened.status})`);
			return { kind: "deferred", reason: opened.reason === "modify-permission-required" ? "permission-required" : "account-unavailable" };
		}
		const { mailbox } = opened;

		const fail = async (outcome: MarkGmailEmailImportedOutcome): Promise<MarkGmailEmailImportedOutcome> => {
			if (outcome.kind === "failed") await updates.markFailed({ userId, origin, reason: outcome.reason, now: deps.now() });
			return outcome;
		};
		const original = await locateOriginal(mailbox, origin);
		if (!original.ok) return fail(original.outcome);
		const labelId = await importedLabelId(mailbox);
		if (!labelId.ok) return fail(labelId.outcome);
		const modified = settle(await mailbox.modifyMessage({ messageId: original.value, addLabelIds: [labelId.value], removeLabelIds: [UNREAD_LABEL] }));
		if (!modified.ok) return fail(modified.outcome);

		await updates.markCompleted({ userId, origin, now: deps.now() });
		return { kind: "marked" };
	};
}
