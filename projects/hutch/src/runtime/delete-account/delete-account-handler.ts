import type {
	Handler,
	SQSBatchItemFailure,
	SQSBatchResponse,
	SQSEvent,
} from "aws-lambda";
import { z } from "zod";
import { type UserId, UserIdSchema } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import { DeleteAccountCommand } from "@packages/hutch-infra-components";
import type {
	CloseUserAccount,
	DestroyUserSessions,
	FindEmailByUserId,
} from "@packages/provider-contracts/auth";
import type { RevokeAllUserOAuthTokens } from "@packages/provider-contracts/oauth";
import type { DeleteAllUserArticles } from "@packages/provider-contracts/article-store";
import type { DeleteDigestByUser } from "@packages/provider-contracts/digest-queue";
import type { DeleteReaderReadyState } from "@packages/provider-contracts/reader-ready-state";
import type { DeleteOnboarding } from "@packages/provider-contracts/ios-onboarding-signal";
import type { DeletePasswordResetTokensByEmail } from "@packages/provider-contracts/password-reset";
import type { DeleteVerificationTokensByUserId } from "@packages/provider-contracts/email-verification";
import type { DeletePendingSignupsByUser } from "@packages/provider-contracts/pending-signup";
import type {
	DeleteSubscription,
	FindSubscriptionByUserId,
} from "@packages/provider-contracts/subscription-providers";
import type { DeleteCustomer } from "@packages/provider-contracts/subscription-billing";
import type {
	DeleteChargeReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type {
	InboxAddressStore,
	InboxEmailLinkStore,
	InboxEmailStore,
} from "@packages/domain/inbox";
import type { DeleteUserExports } from "../providers/user-data-export/user-data-export.types";
import type { RevokeExternalIdpTokens } from "./revoke-external-idp-tokens";

export interface DeleteAccountHandlerDependencies {
	findEmailByUserId: FindEmailByUserId;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	deleteBillingCustomer: DeleteCustomer;
	deleteSubscription: DeleteSubscription;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	deleteChargeReminderSchedule: DeleteChargeReminderSchedule;
	listInboxDeletionReferences: InboxEmailStore["listDeletionReferencesByUserId"];
	deleteAllInboxEmails: InboxEmailStore["deleteAllEmailsByUserId"];
	deleteAllInboxLinks: InboxEmailLinkStore["deleteAllLinksByUserId"];
	tombstoneInboxAddresses: InboxAddressStore["tombstoneUserAddresses"];
	deleteRawEmailObjects: (keys: string[]) => Promise<void>;
	deleteEmailContentObjects: (keys: string[]) => Promise<void>;
	deleteAllUserArticles: DeleteAllUserArticles;
	deleteDigestByUser: DeleteDigestByUser;
	deleteReaderReadyState: DeleteReaderReadyState;
	deleteOnboarding: DeleteOnboarding;
	deleteUserExports: DeleteUserExports;
	deletePasswordResetTokensByEmail: DeletePasswordResetTokensByEmail;
	deleteVerificationTokensByUserId: DeleteVerificationTokensByUserId;
	deletePendingSignupsByUser: DeletePendingSignupsByUser;
	revokeExternalIdpTokens: RevokeExternalIdpTokens;
	revokeAllUserOAuthTokens: RevokeAllUserOAuthTokens;
	destroyUserSessions: DestroyUserSessions;
	closeUserAccount: CloseUserAccount;
	logger: HutchLogger;
}

/** Erase every user-owned store for a deleted account. Each step is idempotent
 * because the queue is at-least-once (a double-confirm enqueues twice) and a
 * step that throws redrives the whole record — so re-running against a partially
 * scrubbed account must converge, never throw on already-absent data. */
async function processCommand(
	userId: UserId,
	deps: DeleteAccountHandlerDependencies,
): Promise<void> {
	// Capture the delivery email before the user row is deleted — password-reset
	// tokens are keyed by email, and closeUserAccount removes the row that
	// findEmailByUserId reads.
	const email = await deps.findEmailByUserId(userId);

	// Billing first: delete the Stripe customer — which immediately cancels any
	// live subscription and detaches every card — then drop the local row.
	// Deleting the customer is the ONLY Stripe write: Stripe cascades the
	// cancellation and then blocks further operations on the customer, so a
	// separate immediate-cancel would be redundant and, on an at-least-once
	// redrive, a non-idempotent re-cancel of an already-cancelled subscription
	// that throws and poisons the queue into the DLQ. deleteCustomer instead
	// treats an already-gone customer as success, so a redrive converges.
	// Founding members have no row; trialing users have a row but no customerId
	// (a local trial with no Stripe object).
	const subscription = await deps.findSubscriptionByUserId(userId);
	if (subscription) {
		if (subscription.customerId) {
			await deps.deleteBillingCustomer({ customerId: subscription.customerId });
		}
		await deps.deleteSubscription({ userId });
	}

	// Delete every per-user schedule so a later fire can't dispatch a command at
	// a deleted account. All five are ResourceNotFound-idempotent.
	await deps.deleteTrialEndSchedule({ userId });
	await deps.deleteDeferredCancellationSchedule({ userId });
	await deps.deleteTrialFeedbackEmailSchedule({ userId });
	await deps.deleteTrialReminderSchedule({ userId });
	await deps.deleteChargeReminderSchedule({ userId });

	// Inbox: read the pointers the email rows hold (S3 keys + link message-ids)
	// while the rows still exist, then delete the S3 objects and link rows, and
	// only then the email rows themselves. The rows are the sole index for those
	// S3 objects (whose keys carry no userId) and link rows (no userId index), so
	// deleting the rows last lets an at-least-once redrive re-derive the pointers
	// from the still-present rows instead of orphaning the raw `.eml`/body objects
	// in S3. Finally tombstone the forwarding addresses (kept reserved, PII
	// stripped, so a freed hash can never be re-minted to leak another user's
	// mail).
	const { receivedAtMessageIds, rawEmailS3Keys, bodyS3Keys } =
		await deps.listInboxDeletionReferences(userId);
	await deps.deleteRawEmailObjects(rawEmailS3Keys);
	await deps.deleteEmailContentObjects(bodyS3Keys);
	await deps.deleteAllInboxLinks(userId, receivedAtMessageIds);
	await deps.deleteAllInboxEmails(userId);
	await deps.tombstoneInboxAddresses(userId);

	// Saved articles and the remaining per-user stores.
	await deps.deleteAllUserArticles(userId);
	await deps.deleteDigestByUser(userId);
	await deps.deleteReaderReadyState(userId);
	await deps.deleteOnboarding({ userId });
	await deps.deleteUserExports(userId);
	if (email !== null) {
		await deps.deletePasswordResetTokensByEmail(email);
	}

	// Signup/verification remnants (all scanned, all no-op when absent): the
	// email-verification token (a `{userId, email}` row the TTL would otherwise
	// keep for the verification window, scrubbed by userId) and any abandoned-
	// checkout pending-signup rows (that table has no TTL, so they'd keep
	// `{email, userId}` forever — scrubbed by userId OR the captured email, since
	// legacy pre-userId rows carry only the email). Import sessions are
	// deliberately NOT scrubbed: their `{userId, urls}` rows self-expire via that
	// table's 24h TTL, so no scan is spent on them.
	await deps.deleteVerificationTokensByUserId(userId);
	await deps.deletePendingSignupsByUser({ userId, email });

	// Credentials last: revoke external IdP tokens, kill OAuth grants and every
	// session, then delete the identity row (and its Gmail uniqueness claim).
	await deps.revokeExternalIdpTokens(userId);
	await deps.revokeAllUserOAuthTokens(userId);
	await deps.destroyUserSessions(userId);
	await deps.closeUserAccount(userId);

	deps.logger.info("[delete-account] completed", { userId });
}

export function initDeleteAccountHandler(
	deps: DeleteAccountHandlerDependencies,
): Handler<SQSEvent, SQSBatchResponse> {
	return async (event) => {
		const batchItemFailures: SQSBatchItemFailure[] = [];

		for (const record of event.Records) {
			try {
				const envelope = z.object({ detail: z.unknown() }).parse(JSON.parse(record.body));
				const detail = DeleteAccountCommand.detailSchema.parse(envelope.detail);
				const userId = UserIdSchema.parse(detail.userId);
				await processCommand(userId, deps);
			} catch (error) {
				deps.logger.error("[delete-account] record failed", {
					messageId: record.messageId,
					error,
				});
				batchItemFailures.push({ itemIdentifier: record.messageId });
			}
		}

		return { batchItemFailures };
	};
}
