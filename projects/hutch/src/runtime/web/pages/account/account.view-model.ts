import type { EffectiveAccess } from "../../../domain/access/effective-access";
import { ACCOUNT_CANCEL_URL, ACCOUNT_SUBSCRIBE_URL } from "./account.url";

export type AccountCardState = "founding" | "active" | "trial" | "inactive";

export interface AccountViewModel {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	statusLine: string;
	trialEndsAtIso?: string;
	trialEndsAtFormatted?: string;
	trialDaysLeft?: number;
	trialDaysLeftWord?: "day" | "days";
	showCancelForm: boolean;
	showSubscribeForm: boolean;
	showExportLink: boolean;
	showCancellingNotice: boolean;
	cancelFormUrl: string;
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
	const daysLeft = Math.max(1, Math.ceil(remaining / 86_400_000));
	return { daysLeft, daysLeftWord: daysLeft === 1 ? "day" : "days" };
}

export interface AccountUrlState {
	cancelling: boolean;
}

export function parseAccountQuery(query: Record<string, unknown> | undefined): AccountUrlState {
	return {
		cancelling: query?.cancelling === "1",
	};
}

function baseFor(state: AccountCardState): {
	state: AccountCardState;
	stateClass: string;
	heading: string;
	cancelFormUrl: string;
	subscribeFormUrl: string;
	exportUrl: string;
	showCancellingNotice: false;
} {
	return {
		state,
		stateClass: `account-card account-card--${state}`,
		heading: "Account",
		cancelFormUrl: ACCOUNT_CANCEL_URL,
		subscribeFormUrl: ACCOUNT_SUBSCRIBE_URL,
		exportUrl: "/export",
		showCancellingNotice: false,
	};
}

export function toAccountViewModel(
	access: EffectiveAccess,
	queryState: AccountUrlState,
	now: Date,
): AccountViewModel {
	switch (access.banner) {
		case "none":
			if (access.tier === "founding") {
				return {
					...baseFor("founding"),
					statusLine: "You're a founding member — free for life.",
					showCancelForm: false,
					showSubscribeForm: false,
					showExportLink: false,
				};
			}
			return {
				...baseFor("active"),
				statusLine: "Subscription: Active.",
				showCancelForm: true,
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
				showCancelForm: true,
				showSubscribeForm: true,
				showExportLink: false,
			};
		}
		case "inactive":
			return {
				...baseFor("inactive"),
				statusLine: "Subscription not active.",
				showCancelForm: false,
				showSubscribeForm: true,
				showExportLink: true,
			};
	}
}
