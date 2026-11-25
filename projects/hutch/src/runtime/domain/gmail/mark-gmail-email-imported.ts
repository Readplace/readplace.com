import {
	type GmailConnection,
	type GmailConnectionStore,
	type GmailMessageOrigin,
	type GmailMessageUpdateFailureReason,
	type GmailMessageUpdateStore,
	sameGmailAccount,
} from "@packages/domain/gmail";
import type { UserId } from "@packages/domain/user";
import type { OpenGmailMailboxForUpdate } from "@packages/provider-contracts/gmail-message-update";
import { GmailUnavailableError, markOriginal } from "./gmail-original-update";
import type { IsGmailSenderMapped } from "./mark-imported-gate";

export type MarkGmailEmailImportedOutcome =
	| { kind: "marked" | "already-marked" | "already-read" | "skipped" }
	| { kind: "deferred"; reason: "permission-required" | "account-unavailable" }
	| { kind: "failed" | "already-failed"; reason: GmailMessageUpdateFailureReason };

export type MarkGmailEmailImported = (input: {
	userId: UserId;
	receivedAtMessageId: string;
	origin: GmailMessageOrigin;
}) => Promise<MarkGmailEmailImportedOutcome>;

function belongsToOrigin(connection: GmailConnection | undefined, origin: GmailMessageOrigin): connection is GmailConnection {
	return connection?.accountEmail !== undefined
		&& connection.disconnectRequestedAt === undefined
		&& sameGmailAccount(connection.accountEmail, origin.accountEmail);
}

export function initMarkGmailEmailImported(deps: {
	updates: GmailMessageUpdateStore;
	isSenderMapped: IsGmailSenderMapped;
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	openMailbox: OpenGmailMailboxForUpdate;
	now: () => Date;
}): MarkGmailEmailImported {
	const { updates } = deps;

	return async ({ userId, receivedAtMessageId, origin }) => {
		if (!(await deps.isSenderMapped({ userId, accountEmail: origin.accountEmail, senderEmail: origin.senderEmail }))) {
			await updates.discardPending({ userId, origin });
			return { kind: "skipped" };
		}
		if (!belongsToOrigin(await deps.connections.findConnectionByUserId(userId), origin)) {
			return { kind: "deferred", reason: "account-unavailable" };
		}

		const recorded = await updates.recordPending({ userId, receivedAtMessageId, origin, now: deps.now() });
		if (recorded.status === "completed") return { kind: recorded.alreadyRead ? "already-read" : "already-marked" };
		if (recorded.status === "failed") return { kind: "already-failed", reason: recorded.failureReason };

		const claimUntil = await updates.claimPending({ userId, origin, now: deps.now() });
		if (claimUntil === undefined) throw new GmailUnavailableError("another worker is processing this Gmail update");
		try {
			// Record pending work before rechecking the grant so a concurrent reconnect can resume it.
			const connection = await deps.connections.findConnectionByUserId(userId);
			if (!belongsToOrigin(connection, origin)) {
				await updates.discardPending({ userId, origin });
				return { kind: "deferred", reason: "account-unavailable" };
			}
			if (connection.revokedAt !== undefined) return { kind: "deferred", reason: "account-unavailable" };

			const opened = await deps.openMailbox({ userId, accountEmail: origin.accountEmail });
			if (!opened.ok) {
				if (opened.reason === "unavailable") throw new GmailUnavailableError(`Gmail unavailable (${opened.status})`);
				return { kind: "deferred", reason: opened.reason === "modify-permission-required" ? "permission-required" : "account-unavailable" };
			}
			const { mailbox } = opened;

			const outcome = await markOriginal({ mailbox, origin });
			if (outcome.kind === "reauth-required") return { kind: "deferred", reason: "account-unavailable" };
			if (outcome.kind === "failed") {
				const marked = await updates.markFailed({ userId, origin, reason: outcome.reason, now: deps.now() });
				return marked === "failed" ? outcome : { kind: "already-failed", reason: outcome.reason };
			}

			await updates.markCompleted({ userId, origin, now: deps.now(), alreadyRead: outcome.kind === "already-read" });
			return outcome;
		} finally {
			await updates.releaseClaim({ userId, origin, claimUntil });
		}
	};
}
