import { z } from "zod";
import type { BillingPlan } from "./subscription-providers";
import type { UserId } from "@packages/domain/user";

export const SubscriptionNextChargeSchema = z.object({
	at: z.string(),
	amountMinor: z.number(),
	currency: z.string(),
});
export type SubscriptionNextCharge = z.infer<typeof SubscriptionNextChargeSchema>;

/** `undefined` means the provider cannot state a next charge — the subscription is
 * gone, is in dunning (an unpaid period never advances), or nothing is owed. That
 * is an answer, not a fault. A transport failure or a 5xx throws instead, so the
 * caller can tell "no charge" apart from "we could not ask". */
export type FindSubscriptionNextCharge = (input: {
	subscriptionId: string;
}) => Promise<SubscriptionNextCharge | undefined>;

export type CancelSubscriptionImmediately = (input: {
	subscriptionId: string;
}) => Promise<void>;

export type OnUnpaidFirstInvoice = "refuse" | "leave-pending";

export type CreateSubscriptionOnExistingCustomer = (input: {
	customerId: string;
	priceId: string;
	userId: UserId;
	onUnpaidFirstInvoice: OnUnpaidFirstInvoice;
}) => Promise<{ subscriptionId: string }>;

export type ScheduleCancellationAtPeriodEnd = (input: {
	subscriptionId: string;
}) => Promise<{ cancellationEffectiveAt: string }>;

export type ReverseScheduledCancellation = (input: {
	subscriptionId: string;
}) => Promise<{ trialEndsAt?: string }>;

export type DeleteCustomer = (input: { customerId: string }) => Promise<void>;

/** Resolves the provider's price id for a plan. The id is discovered from the
 * provider by the plan's stable lookup key rather than configured per
 * environment, so each environment's own credentials find their own prices and
 * there is no id to copy between them. */
export type ResolvePriceId = (plan: BillingPlan) => Promise<string>;
