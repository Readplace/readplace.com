import {
	type GmailConnectionStore,
	type GmailMessageOrigin,
	type GmailMessageUpdateFailureReason,
	type GmailMessageUpdateStore,
	sameGmailAccount,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { OpenGmailMailboxForUpdate } from "@packages/provider-contracts/gmail-message-update";
import { GmailUnavailableError, type GmailOriginalUpdateFailure, importedLabelId, markOriginal } from "./gmail-original-update";
import type { FindMarkImportedSince } from "./mark-imported-gate";

export type MarkGmailEmailImportedOutcome =
	| { kind: "marked" | "already-marked" | "skipped" }
	| { kind: "deferred"; reason: "permission-required" | "account-unavailable" }
	| { kind: "failed" | "already-failed"; reason: GmailMessageUpdateFailureReason };

export type MarkGmailEmailImported = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	origin: GmailMessageOrigin;
}) => Promise<MarkGmailEmailImportedOutcome>;

export function initMarkGmailEmailImported(deps: {
	updates: GmailMessageUpdateStore;
	findMarkImportedSince: FindMarkImportedSince;
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	openMailbox: OpenGmailMailboxForUpdate;
	now: () => Date;
}): MarkGmailEmailImported {
	const { updates } = deps;

	return async ({ userId, receivedAtMessageId, origin }) => {
		if ((await deps.findMarkImportedSince({ userId, accountEmail: origin.accountEmail, senderEmail: origin.senderEmail })) === undefined) {
			await updates.discardPending({ userId, origin });
			return { kind: "skipped" };
		}
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

		const fail = async (outcome: GmailOriginalUpdateFailure): Promise<MarkGmailEmailImportedOutcome> => {
			if (outcome.kind === "reauth-required") return { kind: "deferred", reason: "account-unavailable" };
			const marked = await updates.markFailed({ userId, origin, reason: outcome.reason, now: deps.now() });
			return marked === "failed" ? outcome : { kind: "already-failed", reason: outcome.reason };
		};
		const labelId = await importedLabelId(mailbox);
		if (!labelId.ok) return fail(labelId.outcome);
		const marked = await markOriginal({ mailbox, origin, labelId: labelId.value });
		if (marked.kind !== "marked") return fail(marked);

		await updates.markCompleted({ userId, origin, now: deps.now() });
		return { kind: "marked" };
	};
}
