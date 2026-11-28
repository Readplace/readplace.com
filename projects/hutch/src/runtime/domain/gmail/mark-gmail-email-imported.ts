import {
	type GmailConnection,
	type GmailConnectionStore,
	type GmailMessageOrigin,
	type GmailMessageUpdateFailureReason,
	type GmailMessageUpdateStore,
	gmailMessageOriginKey,
	sameGmailAccount,
} from "@packages/domain/gmail";
import { type EmailImportCompletionStore, isEmailSavedToAll } from "@packages/domain/inbox";
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
	supplemental?: true;
}) => Promise<MarkGmailEmailImportedOutcome>;

function belongsToOrigin(connection: GmailConnection | undefined, origin: GmailMessageOrigin): connection is GmailConnection {
	return connection?.accountEmail !== undefined
		&& connection.disconnectRequestedAt === undefined
		&& sameGmailAccount(connection.accountEmail, origin.accountEmail);
}

export function initMarkGmailEmailImported(deps: {
	updates: GmailMessageUpdateStore;
	isSenderMapped: IsGmailSenderMapped;
	findCompletion: EmailImportCompletionStore["findCompletion"];
	connections: Pick<GmailConnectionStore, "findConnectionByUserId">;
	openMailbox: OpenGmailMailboxForUpdate;
	now: () => Date;
}): MarkGmailEmailImported {
	const { updates } = deps;

	const eligible = async ({ userId, receivedAtMessageId, origin, supplemental }: Parameters<MarkGmailEmailImported>[0]) => {
		const completion = await deps.findCompletion({ userId, receivedAtMessageId });
		if (completion === undefined) return false;

		const originKey = gmailMessageOriginKey(origin);
		const matchesOrigin = (saved: GmailMessageOrigin) => saved.senderEmail === origin.senderEmail && gmailMessageOriginKey(saved) === originKey;
		const followUp = completion.supplementalImport;
		if (supplemental) {
			return followUp !== undefined && matchesOrigin(followUp.origin)
				&& isEmailSavedToAll({ selection: completion.supplementalSelection, savedOutputs: completion.savedOutputs });
		}
		return !(followUp && gmailMessageOriginKey(followUp.origin) === originKey)
			&& isEmailSavedToAll(completion) && completion.origins.some(matchesOrigin);
	};

	return async (input) => {
		const { userId, receivedAtMessageId, origin } = input;
		if (!(await deps.isSenderMapped({ userId, accountEmail: origin.accountEmail, senderEmail: origin.senderEmail })) || !(await eligible(input))) {
			await updates.discardPending({ ...input, ifUnclaimed: { receivedAtMessageId, now: deps.now() } });
			return { kind: "skipped" };
		}
		if (!belongsToOrigin(await deps.connections.findConnectionByUserId(userId), origin)) {
			return { kind: "deferred", reason: "account-unavailable" };
		}

		const recorded = await updates.recordPending({ ...input, now: deps.now() });
		if (recorded.status === "completed") return { kind: recorded.alreadyRead ? "already-read" : "already-marked" };
		if (recorded.status === "failed") return { kind: "already-failed", reason: recorded.failureReason };

		// Claim and bind the durable retry to this verified delivery atomically. A
		// pre-upgrade pending record can reference another, unsaved inbox message.
		const claimUntil = await updates.claimPending({ ...input, now: deps.now() });
		if (claimUntil === undefined) throw new GmailUnavailableError("another worker is processing this Gmail update");
		try {
			// Record pending work before rechecking the grant so a concurrent reconnect can resume it.
			const connection = await deps.connections.findConnectionByUserId(userId);
			if (!belongsToOrigin(connection, origin)) {
				await updates.discardPending(input);
				return { kind: "deferred", reason: "account-unavailable" };
			}
			if (connection.revokedAt !== undefined) return { kind: "deferred", reason: "account-unavailable" };

			if (!(await eligible(input))) {
				await updates.discardPending(input);
				return { kind: "skipped" };
			}

			const opened = await deps.openMailbox({ userId, accountEmail: origin.accountEmail });
			if (!opened.ok) {
				if (opened.reason === "unavailable") throw new GmailUnavailableError(`Gmail unavailable (${opened.status})`);
				return { kind: "deferred", reason: opened.reason === "modify-permission-required" ? "permission-required" : "account-unavailable" };
			}
			const { mailbox } = opened;

			const outcome = await markOriginal({ mailbox, origin });
			if (outcome.kind === "reauth-required") return { kind: "deferred", reason: "account-unavailable" };
			if (outcome.kind === "failed") {
				const marked = await updates.markFailed({ ...input, reason: outcome.reason, now: deps.now() });
				return marked === "failed" ? outcome : { kind: "already-failed", reason: outcome.reason };
			}

			await updates.markCompleted({ ...input, now: deps.now(), alreadyRead: outcome.kind === "already-read" });
			return outcome;
		} finally {
			await updates.releaseClaim({ ...input, claimUntil });
		}
	};
}
