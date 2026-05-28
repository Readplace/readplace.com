import { decomposeTimeLeft } from "@packages/time-left";
import type { EffectiveAccess } from "../../../domain/access/effective-access";
import {
	ACCOUNT_CANCEL_URL,
	ACCOUNT_REACTIVATE_URL,
	ACCOUNT_SUBSCRIBE_URL,
} from "./account.url";

export type AccountCardState =
	| "founding"
	| "active"
	| "trial"
	| "cancellation-scheduled"
	| "inactive"
	| "error-payment-method";

export type AccountActionKey = "subscribe" | "cancel-form" | "reactivate-form";

export type AccountActionVariant = "primary" | "secondary" | "destructive";

export interface AccountAction {
	key: AccountActionKey;
	name: string;
	variant: AccountActionVariant;
	method: "GET" | "POST";
	href: string;
	isLink: boolean;
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

function action(input: Omit<AccountAction, "isLink">): AccountAction {
	return { ...input, isLink: input.method === "GET" };
}

const SUBSCRIBE_ACTION = action({
	key: "subscribe",
	name: "Subscribe — $3.99/month",
	variant: "primary",
	method: "POST",
	href: ACCOUNT_SUBSCRIBE_URL,
});

const CANCEL_FORM_ACTION = action({
	key: "cancel-form",
	name: "Cancel subscription",
	variant: "destructive",
	method: "POST",
	href: ACCOUNT_CANCEL_URL,
});

const REACTIVATE_FORM_ACTION = action({
	key: "reactivate-form",
	name: "Reactivate subscription",
	variant: "primary",
	method: "POST",
	href: ACCOUNT_REACTIVATE_URL,
});

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

export function toAccountViewModel(
	access: EffectiveAccess,
	queryState: AccountUrlState,
	now: Date,
): AccountViewModel {
	// Payment-method error takes priority over every underlying state — the user
	// just bounced off Stripe's create-subscription endpoint.
	if (queryState.errorPaymentMethod) {
		return {
			...baseFor("error-payment-method", []),
			statusLine: "We couldn't restart your subscription.",
			stateIsErrorPaymentMethod: true,
		};
	}

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
				...baseFor("active", queryState.cancelling ? [] : [CANCEL_FORM_ACTION]),
				statusLine: "Subscription: Active.",
				showCancellingNotice: queryState.cancelling,
			};
		case "trial-countdown": {
			const trialEndsAt = access.trialEndsAt;
			const { daysLeft, daysLeftWord } = formatTrialDaysLeft(trialEndsAt, now);
			return {
				...baseFor("trial", [SUBSCRIBE_ACTION]),
				statusLine: `Your free trial ends on ${formatTrialEndsAt(trialEndsAt)} — ${daysLeft} ${daysLeftWord} left.`,
				trialEndsAtIso: trialEndsAt,
				trialEndsAtFormatted: formatTrialEndsAt(trialEndsAt),
				trialDaysLeft: daysLeft,
				trialDaysLeftWord: daysLeftWord,
			};
		}
		case "cancellation-scheduled":
			return {
				...baseFor("cancellation-scheduled", [REACTIVATE_FORM_ACTION]),
				statusLine: `Your subscription ends on ${formatTrialEndsAt(access.cancellationEffectiveAt)}.`,
			};
		case "inactive":
			return {
				...baseFor("inactive", [SUBSCRIBE_ACTION]),
				statusLine: "Subscription not active.",
			};
	}
}
