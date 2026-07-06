import type { UserId } from "@packages/domain/user";
import type { CheckoutSessionId } from "./stripe-checkout";

/** An already-signed-in user clicked Subscribe on /account. There is no
 * account to create — just upsertActive on the existing userId once the
 * Stripe checkout completes. */
export type PendingSignup = {
	method: "existing-user-subscribe";
	email: string;
	userId: UserId;
	returnUrl?: string;
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
 * deleted user's `{email, userId}` forever unless scrubbed. */
export type DeletePendingSignupsByUserId = (userId: UserId) => Promise<void>;
