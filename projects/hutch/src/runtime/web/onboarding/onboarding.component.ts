import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";
import { requireEnv } from "@packages/require-env";
import { BROWSER_EXTENSIONS_OR, NATIVE_APP_DEVICES_OR } from "../shared/client-enumerations";
import { READLIST_DISMISS_ONBOARDING_PATH } from "../pages/readlist/readlist.url";
import { ONBOARDING_STEPS, hasOutstandingStep } from "./onboarding.steps";
import type {
	InstallableClientOnboarding,
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

const STATIC_BASE_URL = requireEnv("STATIC_BASE_URL");
const FOUNDER_AVATAR_URL = `${STATIC_BASE_URL}/fayner-brack.jpg`;

interface OnboardingChecklistOptions {
	dismissed: boolean;
	completedBefore: boolean;
	completionUnearned: boolean;
	returnQuery: string;
}

const BUTTON_CLASS_BY_VARIANT: Record<OnboardingActionVariant, string> = {
	primary: "btn btn--primary btn--compact",
	text: "onboarding__dismiss-text",
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

interface OnboardingStepDisplayModel {
	id: string;
	title: string;
	description: string;
	completeAttr: "true" | "false";
	rowClass: string;
	actions: OnboardingActionDisplayModel[];
}

function toStepDisplayModel(
	step: OnboardingStep,
	ctx: InstallableClientOnboarding,
	returnQuery: string,
): OnboardingStepDisplayModel {
	const isComplete = step.isComplete(ctx);
	return {
		id: step.id,
		title: step.title(ctx),
		description: step.description(ctx),
		completeAttr: isComplete ? "true" : "false",
		rowClass: isComplete
			? "onboarding__step onboarding__step--complete"
			: "onboarding__step",
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

/** Escape card for devices with no installable first-party client. The
 * completion-gated checklist would nag forever there — its install step can
 * never tick — so this drops the steps for an honest message, a link to the
 * install options, and a Dismiss button that sticks on this device. */
function renderNoClientCard(options: OnboardingChecklistOptions): string {
	const stateClass = options.dismissed ? "onboarding--hidden" : "onboarding--visible";
	return render(ONBOARDING_TEMPLATE, {
		noClient: true,
		stateClass,
		dismiss: dismissDisplayModel("dismiss-no-client", options),
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		installOptions: toActionDisplayModel(SEE_INSTALL_OPTIONS_ACTION, ""),
		noClientLede: `Readplace doesn't have an app for this device yet. If you use ${BROWSER_EXTENSIONS_OR} on a computer, or ${NATIVE_APP_DEVICES_OR}, you can install Readplace there.`,
	});
}

export function OnboardingChecklist(
	ctx: OnboardingContext,
	options: OnboardingChecklistOptions,
): string {
	if (!ctx.hasInstallableClient) return renderNoClientCard(options);
	const steps = ONBOARDING_STEPS.map((step) => toStepDisplayModel(step, ctx, options.returnQuery));
	const allComplete = !hasOutstandingStep(ctx);
	/* A checklist that arrives with every step already satisfied congratulates a
	 * reader who did nothing — the state a deep queue lands in the moment a new
	 * step ships. Nothing was accomplished, so nothing is shown. */
	const unearnedCompletion = allComplete && options.completionUnearned;
	const activeStateClass = allComplete
		? "onboarding--complete"
		: "onboarding--visible";
	const stateClass =
		options.dismissed || unearnedCompletion ? "onboarding--hidden" : activeStateClass;
	return render(ONBOARDING_TEMPLATE, {
		steps,
		stateClass,
		allComplete,
		successMessageClass: options.completedBefore
			? "onboarding__success-message onboarding__success-message--hidden"
			: "onboarding__success-message",
		founderAvatarUrl: FOUNDER_AVATAR_URL,
		dismiss: dismissDisplayModel("dismiss-success", options),
	});
}
