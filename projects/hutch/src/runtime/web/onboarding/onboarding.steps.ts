import { createHash } from "node:crypto";
import {
	NEXT_READ_MINIMUM_SAVES,
	hasEnoughSavesForNextRead,
} from "@packages/domain/article";
import { INBOX_ADDRESSES_PATH } from "@packages/domain/inbox";
import { buildExtensionInstallUrl, type PitchablePlatform } from "./extension-install";
import type {
	InstallableClientOnboarding,
	OnboardingAction,
	OnboardingStep,
} from "./onboarding.types";
import { READLIST_EMAIL_STEP_DONE_PATH } from "../pages/readlist/readlist.url";

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

const CHOOSE_BROWSER_ACTION: OnboardingAction = {
	key: "choose-browser",
	method: "GET",
	href: buildExtensionInstallUrl("other"),
	label: "Choose browser",
	variant: "primary",
};

const INSTALL_BROWSER_DESCRIPTION =
	"Add Readplace to your browser and log-in so you can save any page with one click.";

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
		description: "",
		actions: [],
	},
	chrome: {
		title: "Save your first article using the browser extension",
		description: "",
		actions: [],
	},
	iphone: {
		title: "Save your first article using the iPhone app",
		description:
			"Open any page in Safari, tap Share, and choose Readplace to save it to your queue.",
		actions: [],
	},
	other: {
		title: "Save your first article using a browser extension",
		description: "",
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
		href: INBOX_ADDRESSES_PATH,
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
		title: (ctx) => INSTALL_COPY[ctx.platform].title,
		description: (ctx) => INSTALL_COPY[ctx.platform].description,
		isComplete: (ctx) => ctx.installed,
		actions: (ctx) => INSTALL_COPY[ctx.platform].actions,
	},
	{
		id: "save-first-article-via-extension",
		title: (ctx) => SAVE_COPY[ctx.platform].title,
		description: (ctx) => SAVE_COPY[ctx.platform].description,
		isComplete: (ctx) => ctx.savedArticle,
		actions: (ctx) => SAVE_COPY[ctx.platform].actions,
	},
	{
		id: "receive-articles-by-email",
		title: () => EMAIL_STEP_TITLE,
		description: () => EMAIL_STEP_DESCRIPTION,
		isComplete: (ctx) => ctx.inboxArticleQueued || ctx.emailStepMarkedDone,
		actions: () => EMAIL_STEP_ACTIONS,
	},
	{
		id: "save-enough-for-next-read",
		title: () => NEXT_READ_TITLE,
		description: (ctx) => nextReadDescription(ctx.savedCount),
		isComplete: (ctx) => hasEnoughSavesForNextRead(ctx.savedCount),
		actions: () => [],
	},
];

export const ONBOARDING_VERSION = createHash("sha256")
	.update(ONBOARDING_STEPS.map((step) => step.id).sort().join("|"))
	.digest("hex")
	.slice(0, 8);

export function hasOutstandingStep(ctx: InstallableClientOnboarding): boolean {
	return ONBOARDING_STEPS.some((step) => !step.isComplete(ctx));
}

/** Dismiss token for the no-client escape card. Deliberately a fixed string,
 * NOT hashed from the step list like {@link ONBOARDING_VERSION}: a no-client
 * device never sees the steps, so editing them must not rotate this token and
 * re-surface a card the user already dismissed. Never collides with an
 * ONBOARDING_VERSION value (8 hex chars). Bump by hand only if the no-client
 * card's own content changes enough to warrant re-notifying dismissers. */
export const NO_CLIENT_ONBOARDING_VERSION = "no-client";
