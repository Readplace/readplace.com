import type { SubscriptionStatus } from "@packages/provider-contracts/subscription-providers";
import type { TrialExtensionRefusal } from "../../../domain/trial/resolve-trial-extension";
import type { ComponentError } from "../../shared/component-error.types";

export const REFUSAL_MESSAGE: Record<TrialExtensionRefusal["reason"], string> = {
	"founding-member":
		"This user is a founding member with permanent full access. Granting a trial would downgrade them to an expiring one, so it is refused.",
	"paid-subscription":
		"This user has a real Stripe subscription. Opening a trial window would strip their Stripe ids and orphan the subscription, so it is refused — manage them in Stripe or /account.",
	"not-in-future": "The trial has to end in the future.",
};

/** What the operator is shown after an email lookup. The page resolves this;
 * the template only renders it. */
export type ExtendTrialLookup =
	| { kind: "none" }
	| { kind: "not-found"; email: string }
	| { kind: "refused"; email: string; status: SubscriptionStatus | undefined; message: string }
	| {
			kind: "ready";
			email: string;
			status: SubscriptionStatus;
			currentTrialEndsAt: string | undefined;
			trialEndsAtInput: string;
		};

export interface ExtendTrialViewModel {
	email: string;
	emailError: string | undefined;
	trialEndsAtError: string | undefined;
	globalError: string | undefined;
	extended: boolean;
	notFound: boolean;
	refused: boolean;
	ready: boolean;
	status: string | undefined;
	currentTrialEndsAt: string | undefined;
	hasCurrentTrialEndsAt: boolean;
	trialEndsAtInput: string | undefined;
	refusalMessage: string | undefined;
}

/** `<input type="datetime-local">` wants a zone-less `YYYY-MM-DDTHH:mm`. Every
 * stored instant is a UTC ISO string, so slicing keeps the UTC wall clock the
 * field is labelled with. */
export function toDateTimeLocalInput(iso: string): string {
	return iso.slice(0, 16);
}

function errorFor(errors: ComponentError[], fieldName: string): string | undefined {
	return errors.find((error) => error.fieldName === fieldName)?.message;
}

export function toExtendTrialViewModel(input: {
	lookup: ExtendTrialLookup;
	errors?: ComponentError[];
	extended?: boolean;
}): ExtendTrialViewModel {
	const errors = input.errors ?? [];
	const { lookup } = input;
	const email = lookup.kind === "none" ? "" : lookup.email;

	return {
		email,
		emailError: errorFor(errors, "email"),
		trialEndsAtError: errorFor(errors, "trialEndsAt"),
		globalError: errors.find((error) => error.fieldName === undefined)?.message,
		extended: input.extended === true,
		notFound: lookup.kind === "not-found",
		refused: lookup.kind === "refused",
		ready: lookup.kind === "ready",
		status: lookup.kind === "refused" || lookup.kind === "ready" ? lookup.status : undefined,
		currentTrialEndsAt: lookup.kind === "ready" ? lookup.currentTrialEndsAt : undefined,
		hasCurrentTrialEndsAt: lookup.kind === "ready" && lookup.currentTrialEndsAt !== undefined,
		trialEndsAtInput: lookup.kind === "ready" ? lookup.trialEndsAtInput : undefined,
		refusalMessage: lookup.kind === "refused" ? lookup.message : undefined,
	};
}
