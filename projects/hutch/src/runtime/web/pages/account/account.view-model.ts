import { decomposeTimeLeft } from "@packages/time-left";
import type { EffectiveAccess } from "../../../domain/access/effective-access";
import type { SubscriptionRecord } from "@packages/test-fixtures/providers/subscription-providers";
import {
	ACCOUNT_CANCEL_URL,
	ACCOUNT_PAYMENT_METHOD_URL,
	ACCOUNT_REACTIVATE_URL,
} from "./account.url";

export type AccountCardState =
	| "founding"
	| "active"
	| "trial"
	| "cancellation-scheduled"
	| "inactive"
	| "error-payment-method";

export type AccountActionKey =
	| "add-payment-method"
	| "update-payment-method"
	| "cancel-form"
	| "reactivate-form";

export type AccountActionVariant = "primary" | "secondary" | "destructive";

export interface AccountAction {
	key: AccountActionKey;
	name: string;
	variant: AccountActionVariant;
	method: "GET" | "POST";
	href: string;
}

export interface PaymentMethodSummary {
	brand: string;
	last4: string;
}

export interface ChargeFailedSummary {
	reason: string;
}

export interface AccountViewModel {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	statusLine: string;
	trialEndsAtIso?: string;
	trialEndsAtFormatted?: string;
	trialDaysLeft?: number;
	trialDaysLeftWord?: "day" | "days";
	showCancellingNotice: boolean;
	stateIsErrorPaymentMethod: boolean;
	paymentMethod?: PaymentMethodSummary;
	chargeFailed?: ChargeFailedSummary;
	actions: AccountAction[];
}

function formatTrialEndsAt(iso: string): string {
	return new Date(iso).toLocaleDateString("en-AU", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function formatTrialDaysLeft(trialEndsAt: string, now: Date): { daysLeft: number; daysLeftWord: "day" | "days" } {
	const remaining = new Date(trialEndsAt).getTime() - now.getTime();
	const timeLeft = decomposeTimeLeft(remaining);
	const hasRemainder = timeLeft.hours > 0 || timeLeft.minutes > 0 || timeLeft.seconds > 0;
	const daysLeft = Math.max(1, timeLeft.days + (hasRemainder ? 1 : 0));
	return { daysLeft, daysLeftWord: daysLeft === 1 ? "day" : "days" };
}

export interface AccountUrlState {
	cancelling: boolean;
	errorPaymentMethod: boolean;
}

export function parseAccountQuery(query: Record<string, unknown> | undefined): AccountUrlState {
	return {
		cancelling: query?.cancelling === "1",
		errorPaymentMethod: query?.error === "payment_method",
	};
}

const ADD_PAYMENT_METHOD_ACTION: AccountAction = {
	key: "add-payment-method",
	name: "Add payment method",
	variant: "primary",
	method: "POST",
	href: ACCOUNT_PAYMENT_METHOD_URL,
};

const UPDATE_PAYMENT_METHOD_ACTION: AccountAction = {
	key: "update-payment-method",
	name: "Update payment method",
	variant: "secondary",
	method: "POST",
	href: ACCOUNT_PAYMENT_METHOD_URL,
};

const CANCEL_FORM_ACTION: AccountAction = {
	key: "cancel-form",
	name: "Cancel subscription",
	variant: "destructive",
	method: "POST",
	href: ACCOUNT_CANCEL_URL,
};

const REACTIVATE_FORM_ACTION: AccountAction = {
	key: "reactivate-form",
	name: "Reactivate subscription",
	variant: "primary",
	method: "POST",
	href: ACCOUNT_REACTIVATE_URL,
};

function baseFor(state: AccountCardState, actions: AccountAction[]): {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	showCancellingNotice: false;
	stateIsErrorPaymentMethod: false;
	actions: AccountAction[];
} {
	return {
		state,
		stateClass: `account-card account-card--${state}`,
		heading: "Account",
		showCancellingNotice: false,
		stateIsErrorPaymentMethod: false,
		actions,
	};
}

function paymentMethodFrom(row: SubscriptionRecord | undefined): PaymentMethodSummary | undefined {
	if (!row?.paymentMethodId || !row.paymentMethodBrand || !row.paymentMethodLast4) {
		return undefined;
	}
	return { brand: row.paymentMethodBrand, last4: row.paymentMethodLast4 };
}

function chargeFailedFrom(row: SubscriptionRecord | undefined): ChargeFailedSummary | undefined {
	if (!row?.chargeFailedAt) return undefined;
	return { reason: row.chargeFailedReason ?? "card_declined" };
}

export function toAccountViewModel(
	access: EffectiveAccess,
	queryState: AccountUrlState,
	now: Date,
	row?: SubscriptionRecord,
): AccountViewModel {
	if (queryState.errorPaymentMethod) {
		return {
			...baseFor("error-payment-method", []),
			statusLine: "We couldn't restart your subscription.",
			stateIsErrorPaymentMethod: true,
		};
	}

	const paymentMethod = paymentMethodFrom(row);
	const chargeFailed = chargeFailedFrom(row);

	switch (access.banner) {
		case "none":
			if (access.tier === "founding") {
				return {
					...baseFor("founding", []),
					statusLine: "You're a founding member — free for life.",
				};
			}
			return {
				/** Hide the Cancel button while a cancellation is in flight: the
				 * command has already been published and clicking again would
				 * just enqueue a duplicate. The "Cancellation in progress"
				 * notice tells the user what's happening. */
				...baseFor(
					"active",
					queryState.cancelling
						? []
						: [...(paymentMethod ? [UPDATE_PAYMENT_METHOD_ACTION] : [ADD_PAYMENT_METHOD_ACTION]), CANCEL_FORM_ACTION],
				),
				statusLine: paymentMethod
					? `Subscription active. Card: ${paymentMethod.brand} ••••${paymentMethod.last4}.`
					: "Subscription: Active.",
				showCancellingNotice: queryState.cancelling,
				...(paymentMethod ? { paymentMethod } : {}),
				...(chargeFailed ? { chargeFailed } : {}),
			};
		case "trial-countdown": {
			const trialEndsAt = access.trialEndsAt;
			const { daysLeft, daysLeftWord } = formatTrialDaysLeft(trialEndsAt, now);
			const actions: AccountAction[] = paymentMethod
				? [UPDATE_PAYMENT_METHOD_ACTION, CANCEL_FORM_ACTION]
				: [ADD_PAYMENT_METHOD_ACTION];
			return {
				...baseFor("trial", actions),
				statusLine: paymentMethod
					? `Trial in progress. Card on file: ${paymentMethod.brand} ••••${paymentMethod.last4}. Will be charged $3.99 on ${formatTrialEndsAt(trialEndsAt)}.`
					: `Your free trial ends on ${formatTrialEndsAt(trialEndsAt)} — ${daysLeft} ${daysLeftWord} left. Add a card to keep your subscription active.`,
				trialEndsAtIso: trialEndsAt,
				trialEndsAtFormatted: formatTrialEndsAt(trialEndsAt),
				trialDaysLeft: daysLeft,
				trialDaysLeftWord: daysLeftWord,
				...(paymentMethod ? { paymentMethod } : {}),
				...(chargeFailed ? { chargeFailed } : {}),
			};
		}
		case "cancellation-scheduled":
			return {
				...baseFor("cancellation-scheduled", [REACTIVATE_FORM_ACTION]),
				statusLine: `Your subscription ends on ${formatTrialEndsAt(access.cancellationEffectiveAt)}.`,
			};
		case "inactive":
			return {
				...baseFor(
					"inactive",
					[paymentMethod ? UPDATE_PAYMENT_METHOD_ACTION : ADD_PAYMENT_METHOD_ACTION],
				),
				statusLine: "Subscription not active.",
				...(paymentMethod ? { paymentMethod } : {}),
				...(chargeFailed ? { chargeFailed } : {}),
			};
	}
}
