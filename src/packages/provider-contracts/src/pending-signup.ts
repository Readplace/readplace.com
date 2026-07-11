import type { UserId } from "@packages/domain/user";
import type { CheckoutSessionId } from "./hosted-checkout";

/** An already-signed-in user clicked Subscribe on /account. There is no
 * account to create — just upsertActive on the existing userId once the
 * Stripe checkout completes. */
export type PendingSignup = {
	method: "existing-user-subscribe";
	email: string;
	userId: UserId;
	returnUrl?: string;
	trialEndsAt?: string;
};

export interface PendingSignupSummary {
	checkoutSessionId: CheckoutSessionId;
	email: string;
	createdAt?: number;
	checkoutRecoveryEmailSentAt?: number;
}

export type StorePendingSignup = (params: {
	checkoutSessionId: CheckoutSessionId;
	signup: PendingSignup;
	createdAt: number;
}) => Promise<void>;

export type ConsumePendingSignup = (
	checkoutSessionId: CheckoutSessionId,
) => Promise<PendingSignup | null>;

export type ListAllPendingSignups = () => Promise<PendingSignupSummary[]>;

export type MarkCheckoutRecoveryEmailSent = (params: {
	checkoutSessionId: CheckoutSessionId;
	sentAt: number;
}) => Promise<void>;

/** Erase every abandoned-checkout row a user left behind, as part of account
 * deletion. This table has no TTL, so an un-consumed pending-signup row keeps the
 * deleted user's `{email, userId}` forever unless scrubbed. Matched on `userId`
 * OR the normalized `email`: legacy pre-userId rows carry `{checkoutSessionId,
 * method, email}` with no `userId`, so the email is the only handle on them.
 * `email` is `null` only when the identity row is already gone (a redrive after
 * closeUserAccount), in which case the userId match still converges. */
export type DeletePendingSignupsByUser = (params: {
	userId: UserId;
	email: string | null;
}) => Promise<void>;
