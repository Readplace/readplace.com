import type { LogError } from "@packages/logger";
import type {
	CheckoutOffer,
	CheckoutSessionId,
	CheckoutVariant,
	SubscribePlansSource,
} from "@packages/provider-contracts/hosted-checkout";
import type {
	CheckoutActivationSource,
	ClaimPendingSignup,
} from "@packages/provider-contracts/pending-signup";
import type { UpsertActiveSubscription } from "@packages/provider-contracts/subscription-providers";
import type {
	CreateChargeReminderSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type { UserId } from "@packages/domain/user";
import { chargeReminderFiresAt } from "../stripe/stripe-trial-config";

export type CompletedCheckout = {
	checkoutSessionId: CheckoutSessionId;
	subscriptionId: string;
	customerId: string;
	amountTotal: number;
	activatedBy: CheckoutActivationSource;
};

export type CheckoutCompletion = {
	userId: UserId;
	subscriptionId: string;
	checkoutSessionId: CheckoutSessionId;
	paidNow: boolean;
	variant?: CheckoutVariant;
	entrySource: SubscribePlansSource | null;
	offer: CheckoutOffer | null;
	activatedBy: CheckoutActivationSource;
};

export type CheckoutActivation =
	| { outcome: "activated"; returnUrl?: string }
	| { outcome: "already-activated"; returnUrl?: string }
	| { outcome: "not-found" };

export type ActivateCheckout = (checkout: CompletedCheckout) => Promise<CheckoutActivation>;

function asError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

export function initActivateCheckout(deps: {
	claimPendingSignup: ClaimPendingSignup;
	upsertActive: UpsertActiveSubscription;
	recordCheckoutCompleted: (completion: CheckoutCompletion) => void;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	createChargeReminderSchedule: CreateChargeReminderSchedule;
	logError: LogError;
	now: () => Date;
}): ActivateCheckout {
	return async (checkout) => {
		const claim = await deps.claimPendingSignup({
			checkoutSessionId: checkout.checkoutSessionId,
			activatedBy: checkout.activatedBy,
			claimedAt: deps.now().toISOString(),
		});
		if (claim.outcome !== "claimed") return claim;
		const pending = claim.signup;

		await deps.upsertActive({
			userId: pending.userId,
			subscriptionId: checkout.subscriptionId,
			customerId: checkout.customerId,
			plan: pending.plan,
		});
		deps.recordCheckoutCompleted({
			userId: pending.userId,
			subscriptionId: checkout.subscriptionId,
			checkoutSessionId: checkout.checkoutSessionId,
			paidNow: checkout.amountTotal > 0,
			...(pending.variant ? { variant: pending.variant } : {}),
			entrySource: pending.entrySource,
			offer: pending.offer,
			activatedBy: checkout.activatedBy,
		});
		try {
			await deps.deleteTrialEndSchedule({ userId: pending.userId });
			await deps.deleteTrialReminderSchedule({ userId: pending.userId });
		} catch (err) {
			deps.logError(
				"[activate-checkout] Clearing the trial schedules failed — continuing; the user has already paid and is active",
				asError(err),
			);
		}
		if (pending.trialEndsAt) {
			try {
				await deps.createChargeReminderSchedule({
					userId: pending.userId,
					firesAt: chargeReminderFiresAt({
						chargeAt: pending.trialEndsAt,
						now: deps.now(),
					}),
					chargeAt: pending.trialEndsAt,
				});
			} catch (err) {
				deps.logError(
					"[activate-checkout] Charge-reminder schedule creation failed — continuing without the pre-charge email",
					asError(err),
				);
			}
		}
		return {
			outcome: "activated",
			...(pending.returnUrl ? { returnUrl: pending.returnUrl } : {}),
		};
	};
}
