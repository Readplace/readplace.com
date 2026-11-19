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
	FindPendingSignup,
} from "@packages/provider-contracts/pending-signup";
import type {
	FindSubscriptionByUserId,
	UpsertActiveSubscription,
} from "@packages/provider-contracts/subscription-providers";
import type {
	CreateChargeReminderSchedule,
	DeleteDeferredCancellationSchedule,
	DeleteTrialEndSchedule,
	DeleteTrialReminderSchedule,
} from "@packages/provider-contracts/trial-scheduler";
import type { EventInstant } from "@packages/domain/event-envelope";
import type { UserId } from "@packages/domain/user";
import { messagePredatesStatus } from "@packages/subscription-access";
import { chargeReminderFiresAt } from "../stripe/stripe-trial-config";

type CompletedCheckoutFields = {
	checkoutSessionId: CheckoutSessionId;
	subscriptionId: string;
	customerId: string;
	amountTotal: number;
};

export type RedirectCheckout = CompletedCheckoutFields & { activatedBy: "redirect" };

export type WebhookCheckout = CompletedCheckoutFields & { activatedBy: "webhook"; eventTime: EventInstant };

export type CompletedCheckout = RedirectCheckout | WebhookCheckout;

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

export type WebhookCheckoutActivation = CheckoutActivation | { outcome: "predates-status" };

export type ActivateCheckout = {
	(checkout: RedirectCheckout): Promise<CheckoutActivation>;
	(checkout: WebhookCheckout): Promise<WebhookCheckoutActivation>;
};

function asError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

export function initActivateCheckout(deps: {
	findPendingSignup: FindPendingSignup;
	findSubscriptionByUserId: FindSubscriptionByUserId;
	claimPendingSignup: ClaimPendingSignup;
	upsertActive: UpsertActiveSubscription;
	recordCheckoutCompleted: (completion: CheckoutCompletion) => void;
	deleteTrialEndSchedule: DeleteTrialEndSchedule;
	deleteTrialReminderSchedule: DeleteTrialReminderSchedule;
	deleteDeferredCancellationSchedule: DeleteDeferredCancellationSchedule;
	createChargeReminderSchedule: CreateChargeReminderSchedule;
	logError: LogError;
	now: () => Date;
}): ActivateCheckout {
	function activate(checkout: RedirectCheckout): Promise<CheckoutActivation>;
	function activate(checkout: WebhookCheckout): Promise<WebhookCheckoutActivation>;
	async function activate(checkout: CompletedCheckout): Promise<WebhookCheckoutActivation> {
		const lookup = await deps.findPendingSignup(checkout.checkoutSessionId);
		if (lookup.outcome !== "pending") return lookup;
		const { userId, plan } = lookup.signup;

		if (checkout.activatedBy === "webhook") {
			const row = await deps.findSubscriptionByUserId(userId);
			const holdsThisCheckout = row?.status === "active" && row.subscriptionId === checkout.subscriptionId;
			if (!holdsThisCheckout && messagePredatesStatus({ statusEnteredAt: row?.statusEnteredAt, eventTime: checkout.eventTime })) {
				return { outcome: "predates-status" };
			}
		}

		await deps.deleteDeferredCancellationSchedule({ userId });
		await deps.upsertActive({
			userId,
			subscriptionId: checkout.subscriptionId,
			customerId: checkout.customerId,
			plan,
		});

		const claim = await deps.claimPendingSignup({
			checkoutSessionId: checkout.checkoutSessionId,
			activatedBy: checkout.activatedBy,
			claimedAt: deps.now().toISOString(),
		});
		if (claim.outcome !== "claimed") return claim;
		const pending = claim.signup;

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
	}
	return activate;
}
