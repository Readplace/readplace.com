import type { OnboardingStepId } from "../../providers/onboarding/onboarding.types";

export type BrowserName = "firefox" | "chrome" | "other";

export interface OnboardingContext {
	savedViaExtension: boolean;
	extensionInstalled: boolean;
	browser: BrowserName;
	isMobile: boolean;
}

export interface OnboardingAction {
	label: string;
	url: string;
}

export interface OnboardingStep {
	id: OnboardingStepId;
	title: (ctx: OnboardingContext) => string;
	description: string;
	/**
	 * derivable=true: isComplete is computed from request-derived state (cookies,
	 * UA). The /queue handler best-effort persists newly-derived completions.
	 * derivable=false: only an explicit server-side event marks completion; the
	 * persistence table is the source of truth.
	 */
	derivable: boolean;
	isComplete: (ctx: OnboardingContext) => boolean;
	actions?: (ctx: OnboardingContext) => OnboardingAction[];
	isApplicable?: (ctx: OnboardingContext) => boolean;
}
