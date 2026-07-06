import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { ONBOARDING_STEPS } from "./onboarding.steps";
import type { InstallableClientOnboarding, OnboardingAction, OnboardingContext, OnboardingStep } from "./onboarding.types";

export { ONBOARDING_STYLES } from "./onboarding.styles";

const ONBOARDING_TEMPLATE = readFileSync(
	join(__dirname, "onboarding.template.html"),
	"utf-8",
);

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");
const FOUNDER_AVATAR_URL = `${STATIC_BASE_URL}/fayner-brack.jpg`;

interface OnboardingStepDisplayModel {
	id: string;
	title: string;
	description: string;
	completeAttr: "true" | "false";
	rowClass: string;
	checkClass: string;
	actions: OnboardingAction[];
}

function toStepDisplayModel(
	step: OnboardingStep,
	ctx: InstallableClientOnboarding,
): OnboardingStepDisplayModel {
	const isComplete = step.isComplete(ctx);
	const actions = step.actions(ctx);
	return {
		id: step.id,
		title: step.title(ctx),
		description: step.description(ctx),
		completeAttr: isComplete ? "true" : "false",
		rowClass: isComplete
			? "onboarding__step onboarding__step--complete"
			: "onboarding__step",
		checkClass: isComplete
			? "onboarding__check onboarding__check--ticked"
			: "onboarding__check",
		actions,
	};
}

function allStepsComplete(ctx: InstallableClientOnboarding): boolean {
	return ONBOARDING_STEPS.every((step) => step.isComplete(ctx));
}

/** Escape card for devices with no installable first-party client. The
 * completion-gated checklist would nag forever there — its install step can
 * never tick — so this drops the steps for an honest message, a link to the
 * install options, and a Dismiss button that sticks on this device. */
function renderNoClientCard(options: { dismissed?: boolean }): string {
	const stateClass = options.dismissed ? "onboarding--hidden" : "onboarding--visible";
	return render(ONBOARDING_TEMPLATE, {
		noClient: true,
		stateClass,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		installOptionsUrl: "/install",
	});
}

export function OnboardingChecklist(
	ctx: OnboardingContext,
	options: { dismissed?: boolean } = {},
): string {
	if (!ctx.hasInstallableClient) return renderNoClientCard(options);
	const steps = ONBOARDING_STEPS.map((step) => toStepDisplayModel(step, ctx));
	const allComplete = allStepsComplete(ctx);
	const activeStateClass = allComplete
		? "onboarding--complete"
		: "onboarding--visible";
	const stateClass = options.dismissed ? "onboarding--hidden" : activeStateClass;
	return render(ONBOARDING_TEMPLATE, {
		steps,
		stateClass,
		allComplete,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
	});
}
