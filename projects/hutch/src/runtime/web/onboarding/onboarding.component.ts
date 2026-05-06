import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "../render";
import { requireEnv } from "../../require-env";
import { buildExtensionInstallUrl } from "./extension-install";
import { ONBOARDING_STEPS } from "./onboarding.steps";
import type { OnboardingAction, OnboardingContext, OnboardingStep } from "./onboarding.types";

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
	ctx: OnboardingContext,
): OnboardingStepDisplayModel {
	const isComplete = step.isComplete(ctx);
	const actions = step.actions(ctx);
	return {
		id: step.id,
		title: step.title(ctx),
		description: step.description,
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

function allStepsComplete(ctx: OnboardingContext): boolean {
	return ONBOARDING_STEPS.every((step) => step.isComplete(ctx));
}

/** TODO: Remove once Chrome extension v1.0.108+ is published. While the steps
 * isComplete bypass forces success state for all Chrome users, surface the
 * install action inside the success state so users without the extension still
 * have a path to install it.
 * https://chromewebstore.google.com/detail/hutch-%E2%80%94-save-articles-rea/klblengmhlfnmjoagchagfcdbpbocgbf
 */
function chromeBypassSuccessAction(ctx: OnboardingContext): OnboardingAction | undefined {
	if (ctx.browser !== "chrome") return undefined;
	if (ctx.extensionInstalled) return undefined;
	return { label: "Install", url: buildExtensionInstallUrl("chrome") };
}

export function OnboardingChecklist(ctx: OnboardingContext): string {
	const steps = ONBOARDING_STEPS.map((step) => toStepDisplayModel(step, ctx));
	const allComplete = allStepsComplete(ctx);
	const stateClass = allComplete
		? "onboarding--complete"
		: "onboarding--visible";
	return render(ONBOARDING_TEMPLATE, {
		steps,
		stateClass,
		allComplete,
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		successAction: chromeBypassSuccessAction(ctx),
	});
}
