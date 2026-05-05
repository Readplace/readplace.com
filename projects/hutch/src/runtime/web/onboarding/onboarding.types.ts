export type BrowserName = "firefox" | "chrome" | "other";

export interface OnboardingContext {
	savedArticleCount: number;
	extensionInstalled: boolean;
	browser: BrowserName;
	isMobile: boolean;
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
	actions?: (ctx: OnboardingContext) => OnboardingAction[];
	isApplicable?: (ctx: OnboardingContext) => boolean;
}
