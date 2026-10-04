import { createHash } from "node:crypto";
import {
	NEXT_READ_MINIMUM_SAVES,
	hasEnoughSavesForNextRead,
} from "@packages/domain/article";
import { CUSTOM_EMAILS_PATH } from "@packages/domain/inbox";
import { buildExtensionInstallUrl, type PitchablePlatform } from "./extension-install";
import type {
	OnboardingContext,
	OnboardingAction,
	OnboardingStep,
} from "./onboarding.types";
import { READLIST_EMAIL_STEP_DONE_PATH, READLIST_GMAIL_STEP_DISMISS_PATH } from "../pages/readlist/readlist.url";
import { INTEGRATIONS_PATH } from "../pages/integrations/gmail-connect.url";

interface StepCopy {
	title: string;
	description: string;
	actions: OnboardingAction[];
}

function installAction(platform: PitchablePlatform): OnboardingAction {
	return {
		key: "install",
		method: "GET",
		href: buildExtensionInstallUrl(platform),
		label: "Install",
		variant: "primary",
	};
}

function downloadAction(client: {
	platform: PitchablePlatform;
	label: string;
}): OnboardingAction {
	return {
		key: "download-client",
		method: "GET",
		href: buildExtensionInstallUrl(client.platform),
		label: client.label,
		variant: "primary",
	};
}

const CHOOSE_BROWSER_ACTION: OnboardingAction = {
	key: "choose-browser",
	method: "GET",
	href: buildExtensionInstallUrl("other"),
	label: "Choose browser",
	variant: "primary",
};

const INSTALL_BROWSER_DESCRIPTION =
	"Add Readplace to your browser and log-in so you can save any page with one click.";

const SAVE_BROWSER_DESCRIPTION = "This way sites can't block the clean reader view.";

const INSTALL_COPY: Record<PitchablePlatform, StepCopy> = {
	firefox: {
		title: "Install the Firefox browser extension",
		description: INSTALL_BROWSER_DESCRIPTION,
		actions: [installAction("firefox")],
	},
	chrome: {
		title: "Install the Chrome browser extension",
		description: INSTALL_BROWSER_DESCRIPTION,
		actions: [installAction("chrome")],
	},
	iphone: {
		title: "Install the Readplace iPhone app",
		description:
			"Add the Readplace iPhone app and sign in so you can save any page from the iOS share sheet.",
		actions: [installAction("iphone")],
	},
	other: {
		title: "Install a browser extension",
		description: INSTALL_BROWSER_DESCRIPTION,
		actions: [CHOOSE_BROWSER_ACTION],
	},
};

const SAVE_COPY: Record<PitchablePlatform, StepCopy> = {
	firefox: {
		title: "Save your first article using the browser extension",
		description: SAVE_BROWSER_DESCRIPTION,
		actions: [downloadAction({ platform: "firefox", label: "Download Firefox extension" })],
	},
	chrome: {
		title: "Save your first article using the browser extension",
		description: SAVE_BROWSER_DESCRIPTION,
		actions: [downloadAction({ platform: "chrome", label: "Download Chrome extension" })],
	},
	iphone: {
		title: "Save your first article using the iPhone app",
		description:
			"Open any page in Safari, tap Share, and choose Readplace to save it to your queue.",
		actions: [downloadAction({ platform: "iphone", label: "Download the iPhone app" })],
	},
	other: {
		title: "Save your first article using a browser extension",
		description: SAVE_BROWSER_DESCRIPTION,
		actions: [CHOOSE_BROWSER_ACTION],
	},
};

const EMAIL_STEP_TITLE = "Get articles from email";
const EMAIL_STEP_DESCRIPTION =
	"Your account has its own email address. Forward a newsletter, or any email with links in it, and the links are saved here for you to read.";
const EMAIL_STEP_ACTIONS: OnboardingAction[] = [
	{
		key: "see-inbox-address",
		method: "GET",
		href: CUSTOM_EMAILS_PATH,
		label: "See your inbox address",
		variant: "primary",
	},
	{
		key: "email-mark-done",
		method: "POST",
		href: READLIST_EMAIL_STEP_DONE_PATH,
		label: "I've done this already",
		variant: "text",
	},
];

const NEXT_READ_TITLE = `Save ${NEXT_READ_MINIMUM_SAVES} articles so Next Read can start`;

/** Promises readiness, never results: the compute side compares against fewer
 * candidates than the raw save count (it excludes the article in hand and drops
 * uncrawled rows), so reaching the minimum makes Next Read possible, not certain. */
function nextReadDescription(savedCount: number): string {
	return hasEnoughSavesForNextRead(savedCount)
		? "Next Read can analyse now. It only shows when something you've saved relates to what you just read."
		: `Next Read starts analysing at ${NEXT_READ_MINIMUM_SAVES} saves, and only shows when something you've saved relates. You've saved ${savedCount} of ${NEXT_READ_MINIMUM_SAVES}.`;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	{
		id: "install-extension",
		isApplicable: (ctx) => ctx.hasInstallableClient,
		title: (ctx) => ctx.hasInstallableClient ? INSTALL_COPY[ctx.platform].title : "",
		description: (ctx) => ctx.hasInstallableClient ? INSTALL_COPY[ctx.platform].description : "",
		isComplete: (ctx) => ctx.hasInstallableClient && ctx.installed,
		actions: (ctx) => ctx.hasInstallableClient ? INSTALL_COPY[ctx.platform].actions : [],
	},
	{
		id: "save-first-article-via-extension",
		isApplicable: (ctx) => ctx.hasInstallableClient,
		title: (ctx) => ctx.hasInstallableClient ? SAVE_COPY[ctx.platform].title : "",
		description: (ctx) => ctx.hasInstallableClient ? SAVE_COPY[ctx.platform].description : "",
		isComplete: (ctx) => ctx.hasInstallableClient && ctx.savedArticle,
		actions: (ctx) => ctx.hasInstallableClient ? SAVE_COPY[ctx.platform].actions : [],
	},
	{
		id: "receive-articles-by-email",
		isApplicable: (ctx) => ctx.hasInstallableClient,
		title: () => EMAIL_STEP_TITLE,
		description: () => EMAIL_STEP_DESCRIPTION,
		isComplete: (ctx) => ctx.hasInstallableClient && (ctx.inboxArticleQueued || ctx.emailStepMarkedDone),
		actions: () => EMAIL_STEP_ACTIONS,
	},
	{
		id: "connect-gmail",
		isApplicable: (ctx) => ctx.gmail !== undefined,
		isHidden: (ctx) => ctx.gmail?.dismissed === true,
		title: () => "Connect your Gmail",
		description: () => "Connect Gmail to choose which newsletters arrive in Readplace.",
		isComplete: (ctx) => ctx.gmail?.connected === true || ctx.gmail?.dismissed === true,
		actions: () => [
			{ key: "connect-gmail", method: "GET", href: INTEGRATIONS_PATH, label: "Connect your Gmail", variant: "primary" },
			{ key: "gmail-dismiss", method: "POST", href: READLIST_GMAIL_STEP_DISMISS_PATH, label: "I don't want to do this", variant: "text" },
		],
	},
	{
		id: "save-enough-for-next-read",
		isApplicable: (ctx) => ctx.hasInstallableClient,
		title: () => NEXT_READ_TITLE,
		description: (ctx) => ctx.hasInstallableClient ? nextReadDescription(ctx.savedCount) : "",
		isComplete: (ctx) => ctx.hasInstallableClient && hasEnoughSavesForNextRead(ctx.savedCount),
		actions: () => [],
		chip: (ctx) => ctx.hasInstallableClient ? `Saved ${Math.min(ctx.savedCount, NEXT_READ_MINIMUM_SAVES)} of ${NEXT_READ_MINIMUM_SAVES}` : "",
	},
];

function versionFor(steps: readonly OnboardingStep[]): string {
	return createHash("sha256")
		.update(steps.map((step) => step.id).sort().join("|"))
		.digest("hex")
		.slice(0, 8);
}

/** Preserve existing dismissal cookies for accounts that cannot connect Gmail. */
export const ONBOARDING_VERSION = versionFor(ONBOARDING_STEPS.filter((step) => step.id !== "connect-gmail"));
export const GMAIL_ONBOARDING_VERSION = versionFor(ONBOARDING_STEPS);

export function applicableOnboardingSteps(ctx: OnboardingContext): readonly OnboardingStep[] {
	return ONBOARDING_STEPS.filter((step) => step.isApplicable(ctx));
}

export function onboardingVersion(ctx: OnboardingContext): string {
	return versionFor(applicableOnboardingSteps(ctx));
}

export function hasOutstandingGmailStep(ctx: OnboardingContext): boolean {
	return ctx.gmail !== undefined && !ctx.gmail.connected && !ctx.gmail.dismissed;
}

export function firstOutstandingStep(
	ctx: OnboardingContext,
): OnboardingStep | undefined {
	return applicableOnboardingSteps(ctx).find((step) => !step.isComplete(ctx));
}

export function hasOutstandingStep(ctx: OnboardingContext): boolean {
	return firstOutstandingStep(ctx) !== undefined;
}

/** Dismiss token for the no-client escape card. Deliberately a fixed string,
 * NOT hashed from the step list like {@link ONBOARDING_VERSION}: a no-client
 * device never sees the steps, so editing them must not rotate this token and
 * re-surface a card the user already dismissed. Never collides with an
 * ONBOARDING_VERSION value (8 hex chars). Bump by hand only if the no-client
 * card's own content changes enough to warrant re-notifying dismissers. */
export const NO_CLIENT_ONBOARDING_VERSION = "no-client";
