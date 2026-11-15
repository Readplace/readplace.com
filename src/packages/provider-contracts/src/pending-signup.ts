import type { UserId } from "@packages/domain/user";
import type {
	CheckoutOffer,
	CheckoutSessionId,
	CheckoutVariant,
	SubscribePlansSource,
} from "./hosted-checkout";
import type { BillingPlan } from "./subscription-providers";

/** An already-signed-in user clicked Subscribe on /account. There is no
 * account to create — just upsertActive on the existing userId once the
 * Stripe checkout completes. */
export type PendingSignup = {
	method: "existing-user-subscribe";
	email: string;
	userId: UserId;
	returnUrl?: string;
	trialEndsAt?: string;
	/** Optional: rows written before the funnel was instrumented carry no variant. */
	variant?: CheckoutVariant;
	plan?: BillingPlan;
	entrySource: SubscribePlansSource | null;
	offer: CheckoutOffer;
};

export type ConsumedPendingSignup = Omit<PendingSignup, "offer"> & {
	offer: CheckoutOffer | null;
};

export type StorePendingSignup = (params: {
	checkoutSessionId: CheckoutSessionId;
	signup: PendingSignup;
	createdAt: number;
}) => Promise<void>;

export type CheckoutActivationSource = "redirect" | "webhook";

export type PendingSignupClaim =
	| { outcome: "claimed"; signup: ConsumedPendingSignup }
	| { outcome: "already-activated"; returnUrl?: string }
	| { outcome: "not-found" };

export type ClaimPendingSignup = (params: {
	checkoutSessionId: CheckoutSessionId;
	activatedBy: CheckoutActivationSource;
	claimedAt: string;
}) => Promise<PendingSignupClaim>;

/** Erase every abandoned-checkout row a user left behind, as part of account
 * deletion. This table has no TTL, so a pending-signup row keeps the
 * deleted user's `{email, userId}` forever unless scrubbed. Matched on `userId`
 * OR the normalized `email`: legacy pre-userId rows carry `{checkoutSessionId,
 * method, email}` with no `userId`, so the email is the only handle on them.
 * `email` is `null` only when the identity row is already gone (a redrive after
 * closeUserAccount), in which case the userId match still converges. */
export type DeletePendingSignupsByUser = (params: {
	userId: UserId;
	email: string | null;
}) => Promise<void>;
