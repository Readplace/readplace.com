import { DEFAULT_LOCALE, translator } from "@packages/translations";
import { hutchReadlist } from "@packages/translations/hutch-readlist";
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
import { buildReadlistUrl, readlistPreferencesPath, READLIST_CREATE_PATH, READLIST_EMAIL_STEP_DONE_PATH, READLIST_GMAIL_STEP_DISMISS_PATH, READLIST_PATH, READLIST_SMART_SECTION_ID } from "../pages/readlist/readlist.url";
import { INTEGRATIONS_PATH } from "../pages/integrations/gmail-connect.url";

const { t } = translator(hutchReadlist, DEFAULT_LOCALE);

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

function saveArticleAction(platform: PitchablePlatform): OnboardingAction {
	return {
		key: "save-article",
		method: "GET",
		href: buildExtensionInstallUrl(platform),
		label: "Save an article",
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

const SAVE_BROWSER_DESCRIPTION = "Use the browser extension to save your first article for later.";

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
	android: {
		title: "Install the Readplace Android app",
		description:
			"Add the Readplace Android app and sign in so you can save any page from the Android share sheet.",
		actions: [installAction("android")],
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
		actions: [saveArticleAction("firefox")],
	},
	chrome: {
		title: "Save your first article using the browser extension",
		description: SAVE_BROWSER_DESCRIPTION,
		actions: [saveArticleAction("chrome")],
	},
	iphone: {
		title: "Save your first article using the iPhone app",
		description:
			"Open any page in Safari, tap Share, and choose Readplace to save it for later.",
		actions: [saveArticleAction("iphone")],
	},
	android: {
		title: "Save your first article using the Android app",
		description:
			"Open any page in your browser, tap Share, and choose Readplace to save it for later.",
		actions: [saveArticleAction("android")],
	},
	other: {
		title: "Save your first article using a browser extension",
		description: SAVE_BROWSER_DESCRIPTION,
		actions: [CHOOSE_BROWSER_ACTION],
	},
};

const EMAIL_STEP_TITLE = "Get articles from email";
const EMAIL_STEP_DESCRIPTION =
	"Your account has its own custom email. Subscribe to a newsletter with it, or forward any email with links in it, and the links are saved here for you to read.";
const EMAIL_STEP_ACTIONS: OnboardingAction[] = [
	{
		key: "see-inbox-address",
		method: "GET",
		href: CUSTOM_EMAILS_PATH,
		label: "See your custom email",
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

const VIEW_READLIST_ACTION: OnboardingAction = {
	key: "view-readlist",
	method: "GET",
	href: READLIST_PATH,
	label: "View readlist",
	variant: "primary",
};

/** Promises readiness, never results: the compute side compares against fewer
 * candidates than the raw save count (it excludes the article in hand and drops
 * uncrawled rows), so reaching the minimum makes Next Read possible, not certain. */
function nextReadDescription(savedCount: number): string {
	return hasEnoughSavesForNextRead(savedCount)
		? "Next Read can analyse now. It only shows when something you've saved relates to what you just read."
		: `Next Read starts analysing at ${NEXT_READ_MINIMUM_SAVES} saves, and only shows when something you've saved relates.`;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	{
		id: "install-extension",
		isApplicable: (ctx) => ctx.hasInstallableClient,
		title: (ctx) => ctx.hasInstallableClient ? INSTALL_COPY[ctx.platform].title : "",
		description: (ctx) => ctx.hasInstallableClient ? INSTALL_COPY[ctx.platform].description : "",
		isComplete: (ctx) => ctx.hasInstallableClient && ctx.installed,
		partialProgress: () => 0,
		actions: (ctx) => ctx.hasInstallableClient ? INSTALL_COPY[ctx.platform].actions : [],
	},
	{
		id: "save-first-article-via-extension",
		isApplicable: (ctx) => ctx.hasInstallableClient,
		title: (ctx) => ctx.hasInstallableClient ? SAVE_COPY[ctx.platform].title : "",
		description: (ctx) => ctx.hasInstallableClient ? SAVE_COPY[ctx.platform].description : "",
		isComplete: (ctx) => ctx.hasInstallableClient && ctx.savedArticle,
		partialProgress: () => 0,
		actions: (ctx) => ctx.hasInstallableClient ? SAVE_COPY[ctx.platform].actions : [],
	},
	{
		id: "receive-articles-by-email",
		isApplicable: (ctx) => ctx.hasInstallableClient && ctx.paidFeatures,
		title: () => EMAIL_STEP_TITLE,
		description: () => EMAIL_STEP_DESCRIPTION,
		isComplete: (ctx) => ctx.hasInstallableClient && (ctx.inboxArticleQueued || ctx.emailStepMarkedDone),
		partialProgress: () => 0,
		actions: () => EMAIL_STEP_ACTIONS,
	},
	{
		id: "connect-gmail",
		isApplicable: (ctx) => ctx.gmail !== undefined,
		isHidden: (ctx) => ctx.gmail?.dismissed === true,
		title: () => "Connect your Gmail",
		description: () => "Connect Gmail to choose which newsletters arrive in Readplace.",
		isComplete: (ctx) => ctx.gmail?.connected === true || ctx.gmail?.dismissed === true,
		partialProgress: () => 0,
		actions: () => [
			{ key: "connect-gmail", method: "GET", href: INTEGRATIONS_PATH, label: "Connect your Gmail", variant: "primary" },
			{ key: "gmail-dismiss", method: "POST", href: READLIST_GMAIL_STEP_DISMISS_PATH, label: "I don't want to do this", variant: "text" },
		],
	},
	{
		id: "create-smart-readlist",
		isApplicable: (ctx) => ctx.smartReadlist !== undefined,
		isComplete: (ctx) => ctx.smartReadlist?.count === 10,
		isHidden: (ctx) => ctx.smartReadlist?.count === 10,
		title: () => t("smartReadlist.title"),
		description: ({ smartReadlist: smart }) => smart?.configured ? t("smartReadlist.file")
			: smart?.target ? t("smartReadlist.configure") : t("smartReadlist.start"),
		chip: (ctx) => ctx.smartReadlist?.count === undefined ? t("smartReadlist.unavailable")
			: t("smartReadlist.progress", { count: ctx.smartReadlist.count }),
		partialProgress: (ctx) => (ctx.smartReadlist?.count ?? 0) / 10,
		actions: ({ smartReadlist: smart }) => [smartReadlistPrimaryAction(smart)],
	},
	{
		id: "save-enough-for-next-read",
		isApplicable: (ctx) => ctx.hasInstallableClient && ctx.paidFeatures,
		title: () => NEXT_READ_TITLE,
		description: (ctx) => ctx.hasInstallableClient ? nextReadDescription(ctx.savedCount) : "",
		isComplete: (ctx) => ctx.hasInstallableClient && hasEnoughSavesForNextRead(ctx.savedCount),
		partialProgress: (ctx) => ctx.hasInstallableClient ? Math.min(ctx.savedCount, NEXT_READ_MINIMUM_SAVES) / NEXT_READ_MINIMUM_SAVES : 0,
		actions: () => [VIEW_READLIST_ACTION],
		chip: (ctx) => ctx.hasInstallableClient ? `Saved ${Math.min(ctx.savedCount, NEXT_READ_MINIMUM_SAVES)} of ${NEXT_READ_MINIMUM_SAVES}` : "",
	},
];

function smartReadlistPrimaryAction(smart: OnboardingContext["smartReadlist"]): OnboardingAction {
	if (!smart?.target) return { key: "create-readlist", method: "POST", href: READLIST_CREATE_PATH, label: t("smartReadlist.create"), variant: "primary" };
	if (!smart.configured) return { key: "set-preferences", method: "GET", href: `${readlistPreferencesPath(smart.target)}#${READLIST_SMART_SECTION_ID}`, label: t("smartReadlist.preferences"), variant: "primary" };
	if (smart.viewingTarget) return { key: "open-all", method: "GET", href: READLIST_PATH, label: t("smartReadlist.all"), variant: "primary" };
	return { key: "open-smart-readlist", method: "GET", href: buildReadlistUrl({ readlist: smart.target }), label: t("smartReadlist.open"), variant: "primary" };
}

function versionFor(steps: readonly OnboardingStep[]): string {
	return createHash("sha256")
		.update(steps.map((step) => step.id).sort().join("|"))
		.digest("hex")
		.slice(0, 8);
}

/** Preserve existing dismissal cookies for accounts that cannot connect Gmail. */
export const ONBOARDING_VERSION = "fd8f9d8a";
export const GMAIL_ONBOARDING_VERSION = "0e5d4ccc";

export function applicableOnboardingSteps(ctx: OnboardingContext): readonly OnboardingStep[] {
	return ONBOARDING_STEPS.filter((step) => step.isApplicable(ctx));
}

export function onboardingVersion(ctx: OnboardingContext): string {
	return versionFor(applicableOnboardingSteps(ctx));
}

export function hasOutstandingGmailStep(ctx: OnboardingContext): boolean {
	return ctx.gmail !== undefined && !ctx.gmail.connected && !ctx.gmail.dismissed;
}

export function hasOutstandingSmartReadlistStep(ctx: OnboardingContext): boolean {
	const smart = ctx.smartReadlist;
	return smart !== undefined && smart.count !== undefined && smart.count < 10;
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
