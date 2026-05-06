export type BrowserName = "firefox" | "chrome" | "other";

export interface OnboardingContext {
	extensionInstalled: boolean;
	extensionSavedArticle: boolean;
	browser: BrowserName;
}

export interface OnboardingAction {
	label: string;
	url: string;
}

export interface OnboardingStep {
	id: string;
	title: (ctx: OnboardingContext) => string;
	description: string;
	isComplete: (ctx: OnboardingContext) => boolean;
	actions: (ctx: OnboardingContext) => OnboardingAction[];
}
