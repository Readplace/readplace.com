export type Platform = "firefox" | "chrome" | "iphone" | "other";

/** Marketing install-CTA browser buckets — {@link Platform} with iPhone folded into `other`. */
export type InstallBrowser = "firefox" | "chrome" | "other";

export interface OnboardingContext {
	installed: boolean;
	savedArticle: boolean;
	platform: Platform;
	/** False on devices with no installable first-party client (Android, desktop
	 * Safari, iPad, unrecognised UAs), where the completion-gated checklist can
	 * never finish. Drives the no-client escape card. */
	hasInstallableClient: boolean;
}

export interface OnboardingAction {
	label: string;
	url: string;
}

export interface OnboardingStep {
	id: string;
	title: (ctx: OnboardingContext) => string;
	description: (ctx: OnboardingContext) => string;
	isComplete: (ctx: OnboardingContext) => boolean;
	actions: (ctx: OnboardingContext) => OnboardingAction[];
}
