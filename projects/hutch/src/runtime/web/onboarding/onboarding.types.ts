export type Platform = "firefox" | "chrome" | "iphone" | "other";

/** Marketing install-CTA browser buckets — {@link Platform} with iPhone folded into `other`. */
export type InstallBrowser = "firefox" | "chrome" | "other";

export interface OnboardingContext {
	installed: boolean;
	savedArticle: boolean;
	platform: Platform;
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
