import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import type { PitchablePlatform } from "./extension-install";
import { BROWSER_EXTENSIONS_OR, NATIVE_APP_DEVICES_OR } from "../shared/client-enumerations";
import { READLIST_DISMISS_ONBOARDING_PATH } from "../pages/readlist/readlist.url";
import { applicableOnboardingSteps, firstOutstandingStep, hasOutstandingGmailStep } from "./onboarding.steps";
import type {
	OnboardingAction,
	OnboardingActionKey,
	OnboardingActionMethod,
	OnboardingActionVariant,
	OnboardingContext,
	OnboardingStep,
} from "./onboarding.types";

export { ONBOARDING_STYLES } from "./onboarding.styles";

const ONBOARDING_TEMPLATE = readFileSync(
	join(__dirname, "onboarding.template.html"),
	"utf-8",
);

interface OnboardingChecklistOptions {
	dismissed: boolean;
	completedBefore: boolean;
	completionUnearned: boolean;
	returnQuery: string;
}

const BUTTON_CLASS_BY_VARIANT: Record<OnboardingActionVariant, string> = {
	primary: "btn btn--primary btn--s",
	"primary-full-width": "btn btn--primary setup-guide__cta",
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

type StepMarker = OnboardingStepStatus | "partial-1" | "partial-2" | "partial-3";

const STEP_MARKERS: Record<StepMarker, { className: string; glyph: "check" | "dot" | "none" }> = {
	complete: { className: "setup-guide__marker setup-guide__marker--complete", glyph: "check" },
	current: { className: "setup-guide__marker setup-guide__marker--current", glyph: "dot" },
	"partial-1": { className: "setup-guide__marker setup-guide__marker--partial setup-guide__marker--partial-1", glyph: "none" },
	"partial-2": { className: "setup-guide__marker setup-guide__marker--partial setup-guide__marker--partial-2", glyph: "none" },
	"partial-3": { className: "setup-guide__marker setup-guide__marker--partial setup-guide__marker--partial-3", glyph: "none" },
	upcoming: { className: "setup-guide__marker setup-guide__marker--upcoming", glyph: "none" },
};

const PARTIAL_MARKERS = ["partial-1", "partial-2", "partial-3"] as const;

function stepMarker({ status, progress }: { status: OnboardingStepStatus; progress: number }): StepMarker {
	if (status !== "current" || progress === 0) return status;
	return PARTIAL_MARKERS[Math.min(3, Math.ceil(progress * 4)) - 1];
}

const FOLD_OPEN_BY_PLATFORM = {
	chrome: true,
	firefox: true,
	iphone: false,
	other: true,
} satisfies Record<PitchablePlatform, boolean>;

interface OnboardingStepDisplayModel {
	id: string;
	title: string;
	description: string;
	chip: string;
	completeAttr: "true" | "false";
	currentAttr: "true" | "false";
	markerClass: string;
	showCheckIcon: boolean;
	showDot: boolean;
	open: boolean;
	actions: OnboardingActionDisplayModel[];
}

interface OnboardingStepRow {
	step: OnboardingStep;
	ctx: OnboardingContext;
	returnQuery: string;
	status: OnboardingStepStatus;
}

function toStepDisplayModel(row: OnboardingStepRow): OnboardingStepDisplayModel {
	const { step, ctx, returnQuery, status } = row;
	const marker = STEP_MARKERS[stepMarker({ status, progress: step.partialProgress(ctx) })];
	return {
		id: step.id,
		title: step.title(ctx),
		description: step.description(ctx),
		chip: step.chip ? step.chip(ctx) : "",
		completeAttr: status === "complete" ? "true" : "false",
		currentAttr: status === "current" ? "true" : "false",
		markerClass: marker.className,
		showCheckIcon: marker.glyph === "check",
		showDot: marker.glyph === "dot",
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
	variant: "primary-full-width",
};

function renderNoClientCard(
	options: OnboardingChecklistOptions,
	steps: OnboardingStepDisplayModel[],
): string {
	const stateClass = options.dismissed && steps.length === 0 ? "setup-guide--hidden" : "setup-guide--visible";
	return render(ONBOARDING_TEMPLATE, {
		noClient: true,
		stateClass,
		noClientStateClass: options.dismissed ? "setup-guide--hidden" : "setup-guide--visible",
		steps,
		showSteps: steps.length > 0,
		foldOpen: true,
		percent: 0,
		progressBarClass: "setup-guide__progress-bar setup-guide__progress-bar--0",
		dismiss: dismissDisplayModel("dismiss-no-client", options),
		installOptions: toActionDisplayModel(SEE_INSTALL_OPTIONS_ACTION, ""),
		noClientLede: `Readplace doesn't have an app for this device yet. If you use ${BROWSER_EXTENSIONS_OR} on a computer, or ${NATIVE_APP_DEVICES_OR}, you can install Readplace there.`,
	});
}

export function OnboardingChecklist(
	ctx: OnboardingContext,
	options: OnboardingChecklistOptions,
): string {
	const applicable = applicableOnboardingSteps(ctx);
	const outstanding = firstOutstandingStep(ctx);
	const completedCount = applicable.filter((step) => step.isComplete(ctx)).length;
	const percent = applicable.length > 0 ? Math.round((completedCount / applicable.length) * 100) : 0;
	const steps = applicable
		.filter((step) => !step.isHidden?.(ctx) && (ctx.hasInstallableClient || !step.isComplete(ctx)))
		.map((step) =>
		toStepDisplayModel({
			step,
			ctx,
			returnQuery: options.returnQuery,
			status: step.isComplete(ctx) ? "complete" : step === outstanding ? "current" : "upcoming",
		}),
	);
	if (!ctx.hasInstallableClient) return renderNoClientCard(options, steps);
	const allComplete = outstanding === undefined;
	const unearnedCompletion = allComplete && options.completionUnearned;
	const activeStateClass = allComplete ? "setup-guide--complete" : "setup-guide--visible";
	const stateClass =
		(options.dismissed && !hasOutstandingGmailStep(ctx)) || unearnedCompletion ? "setup-guide--hidden" : activeStateClass;
	return render(ONBOARDING_TEMPLATE, {
		steps,
		showSteps: !allComplete,
		stateClass,
		foldOpen: FOLD_OPEN_BY_PLATFORM[ctx.platform],
		allComplete,
		percent,
		progressBarClass: `setup-guide__progress-bar setup-guide__progress-bar--${percent}`,
		successMessageClass: options.completedBefore
			? "setup-guide__success-message setup-guide__success-message--hidden"
			: "setup-guide__success-message",
		dismiss: dismissDisplayModel("dismiss-success", options),
	});
}
