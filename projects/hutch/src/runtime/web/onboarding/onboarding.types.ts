import type { ClientNameInGroup } from "@packages/supported-clients";

export type Platform = ClientNameInGroup<"browserExtension" | "nativeApp"> | "other";

/** Marketing install-CTA browser buckets — {@link Platform} with iPhone folded into `other`. */
export type InstallBrowser = ClientNameInGroup<"browserExtension"> | "other";

/** Onboarding for a device that has an installable first-party client (a
 * browser extension, or the iPhone app): the completion-gated step checklist,
 * with the per-step signals it reads. */
export interface InstallableClientOnboarding {
	hasInstallableClient: true;
	installed: boolean;
	savedArticle: boolean;
	platform: Platform;
}

/** Onboarding for a device with no installable first-party client (Android,
 * desktop Safari, iPad, unrecognised UAs): the no-client escape card. It carries
 * no `platform`/`installed`/`savedArticle` — the step checklist never renders
 * here, so there is deliberately no per-step signal that could disagree with the
 * no-client state (e.g. an Android visitor whose `platform` resolves to `chrome`
 * yet has no installable client). */
interface NoInstallableClientOnboarding {
	hasInstallableClient: false;
}

export type OnboardingContext =
	| InstallableClientOnboarding
	| NoInstallableClientOnboarding;

export interface OnboardingAction {
	label: string;
	url: string;
}

export interface OnboardingStep {
	id: string;
	title: (ctx: InstallableClientOnboarding) => string;
	description: (ctx: InstallableClientOnboarding) => string;
	isComplete: (ctx: InstallableClientOnboarding) => boolean;
	actions: (ctx: InstallableClientOnboarding) => OnboardingAction[];
}
