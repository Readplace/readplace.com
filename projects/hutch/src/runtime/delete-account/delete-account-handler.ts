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
import type {
	DeleteSubscription,
	FindSubscriptionByUserId,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CancelSubscriptionImmediately,
	DeleteCustomer,
} from "@packages/provider-contracts/stripe-subscriptions";
import type {
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialFeedbackEmailSchedule,
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
	cancelStripeSubscription: CancelSubscriptionImmediately;
	deleteStripeCustomer: DeleteCustomer;
	deleteSubscription: DeleteSubscription;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	deleteTrialFeedbackEmailSchedule: DeleteTrialFeedbackEmailSchedule;
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

	// Billing first: cancel any live subscription and delete the Stripe customer
	// (which detaches every card) before dropping the local row. Founding members
	// have no row; trialing users have a row but no subscriptionId/customerId.
	const subscription = await deps.findSubscriptionByUserId(userId);
	if (subscription) {
		if (subscription.subscriptionId) {
			await deps.cancelStripeSubscription({ subscriptionId: subscription.subscriptionId });
		}
		if (subscription.customerId) {
			await deps.deleteStripeCustomer({ customerId: subscription.customerId });
		}
		await deps.deleteSubscription({ userId });
	}

	// Delete every per-user schedule so a later fire can't dispatch a command at
	// a deleted account. All three are ResourceNotFound-idempotent.
	await deps.deleteTrialEndSchedule({ userId });
	await deps.deleteDeferredCancellationSchedule({ userId });
	await deps.deleteTrialFeedbackEmailSchedule({ userId });

	// Inbox: delete the email rows (returns their ids + S3 keys), then the link
	// rows keyed off those ids (that table has no userId index), then the S3
	// objects, then tombstone the forwarding addresses (kept reserved, PII
	// stripped, so a freed hash can never be re-minted to leak another user's
	// mail).
	const { receivedAtMessageIds, rawEmailS3Keys, bodyS3Keys } =
		await deps.deleteAllInboxEmails(userId);
	await deps.deleteAllInboxLinks(userId, receivedAtMessageIds);
	await deps.deleteRawEmailObjects(rawEmailS3Keys);
	await deps.deleteEmailContentObjects(bodyS3Keys);
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
