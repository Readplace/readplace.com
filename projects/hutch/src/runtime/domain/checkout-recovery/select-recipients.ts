import type {
	CheckoutSessionId,
	RetrieveCheckoutSession,
} from "@packages/test-fixtures/providers/stripe-checkout";
import type { PendingSignupSummary } from "@packages/test-fixtures/providers/pending-signup";

const ONE_HOUR_SECONDS = 60 * 60;

export interface RecoveryCandidate {
	checkoutSessionId: CheckoutSessionId;
	email: string;
}

export type SkipReason =
	| "already-sent"
	| "session-not-found"
	| "already-founding-member"
	| "session-too-recent";

export interface SkippedRow {
	checkoutSessionId: CheckoutSessionId;
	email: string;
	reason: SkipReason;
}

export interface SelectRecipientsResult {
	recipients: RecoveryCandidate[];
	skipped: SkippedRow[];
}

export async function selectRecipients(params: {
	now: Date;
	rows: PendingSignupSummary[];
	retrieveCheckoutSession: RetrieveCheckoutSession;
}): Promise<SelectRecipientsResult> {
	const nowSeconds = Math.floor(params.now.getTime() / 1000);
	const recipients: RecoveryCandidate[] = [];
	const skipped: SkippedRow[] = [];

	for (const row of params.rows) {
		if (row.checkoutRecoveryEmailSentAt !== undefined) {
			skipped.push({
				checkoutSessionId: row.checkoutSessionId,
				email: row.email,
				reason: "already-sent",
			});
			continue;
		}

		const session = await params.retrieveCheckoutSession(row.checkoutSessionId);
		if (!session.ok) {
			skipped.push({
				checkoutSessionId: row.checkoutSessionId,
				email: row.email,
				reason: "session-not-found",
			});
			continue;
		}

		if (session.paid) {
			skipped.push({
				checkoutSessionId: row.checkoutSessionId,
				email: row.email,
				reason: "already-founding-member",
			});
			continue;
		}

		if (nowSeconds - session.created < ONE_HOUR_SECONDS) {
			skipped.push({
				checkoutSessionId: row.checkoutSessionId,
				email: row.email,
				reason: "session-too-recent",
			});
			continue;
		}

		recipients.push({
			checkoutSessionId: row.checkoutSessionId,
			email: row.email,
		});
	}

	return { recipients, skipped };
}
