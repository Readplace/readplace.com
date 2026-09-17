import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import { BROWSER_EXTENSIONS_OR, NATIVE_APP_DEVICES_OR } from "../shared/client-enumerations";
import { READLIST_DISMISS_ONBOARDING_PATH } from "../pages/readlist/readlist.url";
import { ONBOARDING_STEPS, firstOutstandingStep } from "./onboarding.steps";
import type {
	InstallableClientOnboarding,
	OnboardingAction,
	OnboardingActionKey,
	OnboardingActionMethod,
	OnboardingActionVariant,
	OnboardingContext,
	OnboardingStep,
} from "./onboarding.types";

export { ONBOARDING_DESIGN_STYLES } from "./onboarding-design.styles";

const ONBOARDING_DESIGN_TEMPLATE = readFileSync(
	join(__dirname, "onboarding-design.template.html"),
	"utf-8",
);

interface OnboardingChecklistOptions {
	dismissed: boolean;
	completedBefore: boolean;
	completionUnearned: boolean;
	returnQuery: string;
}

const BUTTON_CLASS_BY_VARIANT: Record<OnboardingActionVariant, string> = {
	primary: "btn btn--primary btn--compact",
	text: "setup-guide__action-text",
};

interface OnboardingActionDisplayModel {
	key: string;
	method: OnboardingActionMethod;
	action: string;
	inputs: { name: string; value: string }[];
	label: string;
	buttonClass: string;
}

const ONBOARDING_SOURCE = "onboarding";

function toActionDisplayModel(
	action: OnboardingAction,
	returnQuery: string,
): OnboardingActionDisplayModel {
	const shared = {
		key: action.key,
		method: action.method,
		label: action.label,
		buttonClass: BUTTON_CLASS_BY_VARIANT[action.variant],
	};
	const tracking = { source: ONBOARDING_SOURCE, content: action.key };
	if (action.method === "POST") {
		const href = withInternalTracking(`${action.href}${returnQuery}`, tracking);
		return { ...shared, action: href, inputs: [] };
	}
	const [path, query] = withInternalTracking(action.href, tracking).split("?");
	const inputs = [...new URLSearchParams(query)].map(([name, value]) => ({ name, value }));
	return { ...shared, action: path, inputs };
}

type OnboardingStepStatus = "complete" | "current" | "upcoming";

const STEP_ROW_CLASS: Record<OnboardingStepStatus, string> = {
	complete: "setup-guide__step setup-guide__step--complete",
	current: "setup-guide__step setup-guide__step--current",
	upcoming: "setup-guide__step setup-guide__step--upcoming",
};

const STEP_MARKER_CLASS: Record<OnboardingStepStatus, string> = {
	complete: "setup-guide__marker setup-guide__marker--complete",
	current: "setup-guide__marker setup-guide__marker--current",
	upcoming: "setup-guide__marker setup-guide__marker--upcoming",
};

interface OnboardingStepDisplayModel {
	id: string;
	title: string;
	description: string;
	chip: string;
	completeAttr: "true" | "false";
	currentAttr: "true" | "false";
	rowClass: string;
	markerClass: string;
	showCheckIcon: boolean;
	showDot: boolean;
	open: boolean;
	actions: OnboardingActionDisplayModel[];
}

interface OnboardingStepRow {
	step: OnboardingStep;
	ctx: InstallableClientOnboarding;
	returnQuery: string;
	status: OnboardingStepStatus;
}

function toStepDisplayModel(row: OnboardingStepRow): OnboardingStepDisplayModel {
	const { step, ctx, returnQuery, status } = row;
	return {
		id: step.id,
		title: step.title(ctx),
		description: step.description(ctx),
		chip: step.chip ? step.chip(ctx) : "",
		completeAttr: status === "complete" ? "true" : "false",
		currentAttr: status === "current" ? "true" : "false",
		rowClass: STEP_ROW_CLASS[status],
		markerClass: STEP_MARKER_CLASS[status],
		showCheckIcon: status === "complete",
		showDot: status === "current",
		open: status === "current",
		actions: step.actions(ctx).map((action) => toActionDisplayModel(action, returnQuery)),
	};
}

function dismissDisplayModel(
	key: Extract<OnboardingActionKey, "dismiss-no-client" | "dismiss-success">,
	options: OnboardingChecklistOptions,
): OnboardingActionDisplayModel {
	return toActionDisplayModel(
		{
			key,
			method: "POST",
			href: READLIST_DISMISS_ONBOARDING_PATH,
			label: "Dismiss",
			variant: "text",
		},
		options.returnQuery,
	);
}

const SEE_INSTALL_OPTIONS_ACTION: OnboardingAction = {
	key: "see-install-options",
	method: "GET",
	href: "/install",
	label: "See install options",
	variant: "primary",
};

const TOTAL_STEPS = ONBOARDING_STEPS.length;

const PROGRESS_BAR_CLASSES: readonly string[] = Array.from(
	{ length: TOTAL_STEPS + 1 },
	(_, completedCount) => `setup-guide__progress-bar setup-guide__progress-bar--${completedCount}`,
);

function progressBarClass(completedCount: number): string {
	const progressClass = PROGRESS_BAR_CLASSES[completedCount];
	assert(progressClass, `no progress-bar class for completedCount=${completedCount}`);
	return progressClass;
}

function percentComplete(completedCount: number): number {
	return Math.round((completedCount / TOTAL_STEPS) * 100);
}

function renderNoClientCard(options: OnboardingChecklistOptions): string {
	const stateClass = options.dismissed ? "setup-guide--hidden" : "setup-guide--visible";
	return render(ONBOARDING_DESIGN_TEMPLATE, {
		noClient: true,
		stateClass,
		dismiss: dismissDisplayModel("dismiss-no-client", options),
		installOptions: toActionDisplayModel(SEE_INSTALL_OPTIONS_ACTION, ""),
		noClientLede: `Readplace doesn't have an app for this device yet. If you use ${BROWSER_EXTENSIONS_OR} on a computer, or ${NATIVE_APP_DEVICES_OR}, you can install Readplace there.`,
	});
}

export function OnboardingDesignChecklist(
	ctx: OnboardingContext,
	options: OnboardingChecklistOptions,
): string {
	if (!ctx.hasInstallableClient) return renderNoClientCard(options);
	const outstanding = firstOutstandingStep(ctx);
	const completedCount = ONBOARDING_STEPS.filter((step) => step.isComplete(ctx)).length;
	const steps = ONBOARDING_STEPS.map((step) =>
		toStepDisplayModel({
			step,
			ctx,
			returnQuery: options.returnQuery,
			status: step.isComplete(ctx) ? "complete" : step === outstanding ? "current" : "upcoming",
		}),
	);
	const allComplete = outstanding === undefined;
	const unearnedCompletion = allComplete && options.completionUnearned;
	const activeStateClass = allComplete ? "setup-guide--complete" : "setup-guide--visible";
	const stateClass =
		options.dismissed || unearnedCompletion ? "setup-guide--hidden" : activeStateClass;
	return render(ONBOARDING_DESIGN_TEMPLATE, {
		steps,
		stateClass,
		allComplete,
		percent: percentComplete(completedCount),
		progressBarClass: progressBarClass(completedCount),
		successMessageClass: options.completedBefore
			? "setup-guide__success-message setup-guide__success-message--hidden"
			: "setup-guide__success-message",
		dismiss: dismissDisplayModel("dismiss-success", options),
	});
}
