import type { AdvertisedClientNameInCategory, ClientNameInCategory } from "@packages/supported-clients";

/** A device's installable first-party client, or `other`. These are exactly the
 * content-capture clients (browser extensions + the phone apps), keyed off the
 * category so a new content-capture client widens onboarding automatically. */
export type Platform = ClientNameInCategory<"contentCapture"> | "other";

/** Onboarding for a device that has an installable first-party client (a
 * browser extension, or one of the phone apps): the completion-gated step
 * checklist, with the per-step signals it reads. */
export interface InstallableClientOnboarding {
	hasInstallableClient: true;
	installed: boolean;
	savedArticle: boolean;
	/** Saves counted toward the Next Read milestone, capped at
	 * `NEXT_READ_MINIMUM_SAVES`. An account that already earned the milestone
	 * resolves straight to the cap, which is how "sticky" is expressed without a
	 * second field the count could disagree with. Account-scoped, unlike the
	 * device-scoped `installed` / `savedArticle` above. */
	savedCount: number;
	/** Narrower than {@link Platform}: a checklist only ever renders for a
	 * device whose client is advertised, so the copy maps it indexes never need
	 * an entry for one that is not. */
	platform: AdvertisedClientNameInCategory<"contentCapture"> | "other";
	inboxArticleQueued: boolean;
	emailStepMarkedDone: boolean;
}

/** Onboarding for a device with no installable first-party client (desktop
 * Safari, iPad, unrecognised UAs): the no-client escape card. It carries no
 * `platform`/`installed`/`savedArticle` — the step checklist never renders
 * here, so there is deliberately no per-step signal that could disagree with the
 * no-client state. */
interface NoInstallableClientOnboarding {
	hasInstallableClient: false;
}

export type OnboardingContext =
	| InstallableClientOnboarding
	| NoInstallableClientOnboarding;

export type OnboardingActionMethod = "GET" | "POST";
export type OnboardingActionVariant = "primary" | "text";
export type OnboardingActionKey =
	| "install"
	| "choose-browser"
	| "see-install-options"
	| "see-inbox-address"
	| "email-mark-done";

export interface OnboardingAction {
	key: OnboardingActionKey;
	method: OnboardingActionMethod;
	href: string;
	label: string;
	variant: OnboardingActionVariant;
}

export interface OnboardingStep {
	id: string;
	title: (ctx: InstallableClientOnboarding) => string;
	description: (ctx: InstallableClientOnboarding) => string;
	isComplete: (ctx: InstallableClientOnboarding) => boolean;
	actions: (ctx: InstallableClientOnboarding) => OnboardingAction[];
}
