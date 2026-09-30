import assert from "node:assert";
import type { SubscriptionRecord } from "@packages/provider-contracts/subscription-providers";
import { type EffectiveAccess, resolveEffectiveAccess } from "@packages/subscription-access";
import { PLANS_PAGE_TERMS, type PlansPageTerms } from "@packages/web-analytics";
import { type LocalTime, toAbsoluteDateTime } from "@packages/web-shell";
import { payCutoff, trialEndToPreserve } from "../../../domain/stripe/stripe-trial-config";
import type { SubscribeBranchKey } from "./account.page";

interface PlansPageTermsNote {
	parts: readonly { lead: string; time: LocalTime }[];
	tail: string;
}

export interface PlansPageViewModel {
	terms: PlansPageTerms;
	tier: EffectiveAccess["tier"];
	termsNote: PlansPageTermsNote;
}

export type PlansPageOutcome =
	| { kind: "render"; viewModel: PlansPageViewModel }
	| { kind: "redirect-to-account" };

const TRIAL_PRESERVED_CUTOFF_LEAD = "Choose before ";
const TRIAL_PRESERVED_TRIAL_END_LEAD = " and nothing is charged until ";
const TRIAL_PRESERVED_TAIL = ". Cancel any time before then.";
const CHARGE_TODAY_NOTE: PlansPageTermsNote = { parts: [], tail: "Your first charge is today." };
const CARD_ON_FILE_NOTE: PlansPageTermsNote = {
	parts: [],
	tail: "Choosing a plan charges your card on file today.",
};

const REDIRECT_TO_ACCOUNT: PlansPageOutcome = { kind: "redirect-to-account" };

function trialPreservedNote(trialEndsAt: string): PlansPageTermsNote {
	return {
		parts: [
			{ lead: TRIAL_PRESERVED_CUTOFF_LEAD, time: toAbsoluteDateTime({ iso: payCutoff(trialEndsAt) }) },
			{ lead: TRIAL_PRESERVED_TRIAL_END_LEAD, time: toAbsoluteDateTime({ iso: trialEndsAt }) },
		],
		tail: TRIAL_PRESERVED_TAIL,
	};
}

type PlansPageOutcomeFor = (input: { row: SubscriptionRecord | undefined; now: Date }) => PlansPageOutcome;

const PLANS_PAGE_OUTCOMES: Record<SubscribeBranchKey, PlansPageOutcomeFor> = {
	trialing: ({ row, now }) => {
		assert(row, "the trialing branch requires a subscription row");
		const tier = resolveEffectiveAccess(row, now).tier;
		const preservedTrialEnd = trialEndToPreserve({ row, now });
		if (preservedTrialEnd === undefined) {
			return {
				kind: "render",
				viewModel: { terms: PLANS_PAGE_TERMS.chargeToday, tier, termsNote: CHARGE_TODAY_NOTE },
			};
		}
		return {
			kind: "render",
			viewModel: {
				terms: PLANS_PAGE_TERMS.trialPreserved,
				tier,
				termsNote: trialPreservedNote(preservedTrialEnd),
			},
		};
	},
	cancelled: ({ row, now }) => {
		assert(row, "the cancelled branch requires a subscription row");
		return {
			kind: "render",
			viewModel: {
				terms: PLANS_PAGE_TERMS.chargeToday,
				tier: resolveEffectiveAccess(row, now).tier,
				termsNote: row.customerId ? CARD_ON_FILE_NOTE : CHARGE_TODAY_NOTE,
			},
		};
	},
	noop: () => REDIRECT_TO_ACCOUNT,
	forbidden: () => REDIRECT_TO_ACCOUNT,
};

export function toPlansPageOutcome(input: {
	branch: SubscribeBranchKey;
	row: SubscriptionRecord | undefined;
	now: Date;
}): PlansPageOutcome {
	return PLANS_PAGE_OUTCOMES[input.branch]({ row: input.row, now: input.now });
}
