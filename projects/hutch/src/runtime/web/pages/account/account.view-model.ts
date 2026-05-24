import { decomposeTimeLeft } from "@packages/time-left";
import type { EffectiveAccess } from "../../../domain/access/effective-access";
import {
	ACCOUNT_CANCEL_URL,
	ACCOUNT_CONFIRM_CANCEL_URL,
	ACCOUNT_SUBSCRIBE_URL,
} from "./account.url";

export type AccountCardState =
	| "founding"
	| "active"
	| "trial"
	| "inactive"
	| "confirm-cancel"
	| "error-payment-method";

export interface AccountViewModel {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	statusLine: string;
	trialEndsAtIso?: string;
	trialEndsAtFormatted?: string;
	trialDaysLeft?: number;
	trialDaysLeftWord?: "day" | "days";
	showCancelLink: boolean;
	showSubscribeForm: boolean;
	showExportLink: boolean;
	showCancellingNotice: boolean;
	stateIsConfirmCancel: boolean;
	stateIsErrorPaymentMethod: boolean;
	cancelFormUrl: string;
	cancelLinkUrl: string;
	subscribeFormUrl: string;
	exportUrl: string;
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
	confirmCancel: boolean;
	errorPaymentMethod: boolean;
}

export function parseAccountQuery(query: Record<string, unknown> | undefined): AccountUrlState {
	return {
		cancelling: query?.cancelling === "1",
		confirmCancel: query?.confirm === "cancel",
		errorPaymentMethod: query?.error === "payment_method",
	};
}

function baseFor(state: AccountCardState): {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	cancelFormUrl: string;
	cancelLinkUrl: string;
	subscribeFormUrl: string;
	exportUrl: string;
	showCancellingNotice: false;
	stateIsConfirmCancel: false;
	stateIsErrorPaymentMethod: false;
} {
	return {
		state,
		stateClass: `account-card account-card--${state}`,
		heading: "Account",
		cancelFormUrl: ACCOUNT_CANCEL_URL,
		cancelLinkUrl: ACCOUNT_CONFIRM_CANCEL_URL,
		subscribeFormUrl: ACCOUNT_SUBSCRIBE_URL,
		exportUrl: "/export",
		showCancellingNotice: false,
		stateIsConfirmCancel: false,
		stateIsErrorPaymentMethod: false,
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
			...baseFor("error-payment-method"),
			statusLine: "We couldn't restart your subscription.",
			showCancelLink: false,
			showSubscribeForm: false,
			showExportLink: true,
			stateIsErrorPaymentMethod: true,
		};
	}

	// Confirmation step is only reachable from the active state (i.e. the user
	// can actually cancel). For any other state, fall through to the underlying
	// branch — the link is not rendered there.
	if (queryState.confirmCancel && access.banner === "none" && access.tier === "paid") {
		return {
			...baseFor("confirm-cancel"),
			statusLine: "",
			showCancelLink: false,
			showSubscribeForm: false,
			showExportLink: false,
			stateIsConfirmCancel: true,
		};
	}

	switch (access.banner) {
		case "none":
			if (access.tier === "founding") {
				return {
					...baseFor("founding"),
					statusLine: "You're a founding member — free for life.",
					showCancelLink: false,
					showSubscribeForm: false,
					showExportLink: false,
				};
			}
			return {
				...baseFor("active"),
				statusLine: "Subscription: Active.",
				showCancelLink: true,
				showSubscribeForm: false,
				showExportLink: false,
				showCancellingNotice: queryState.cancelling,
			};
		case "trial-countdown": {
			const trialEndsAt = access.trialEndsAt;
			const { daysLeft, daysLeftWord } = formatTrialDaysLeft(trialEndsAt, now);
			return {
				...baseFor("trial"),
				statusLine: `Your free trial ends on ${formatTrialEndsAt(trialEndsAt)} — ${daysLeft} ${daysLeftWord} left.`,
				trialEndsAtIso: trialEndsAt,
				trialEndsAtFormatted: formatTrialEndsAt(trialEndsAt),
				trialDaysLeft: daysLeft,
				trialDaysLeftWord: daysLeftWord,
				showCancelLink: true,
				showSubscribeForm: true,
				showExportLink: false,
			};
		}
		case "inactive":
			return {
				...baseFor("inactive"),
				statusLine: "Subscription not active.",
				showCancelLink: false,
				showSubscribeForm: true,
				showExportLink: true,
			};
	}
}
