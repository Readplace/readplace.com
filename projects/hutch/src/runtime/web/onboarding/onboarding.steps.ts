import { createHash } from "node:crypto";
import { buildExtensionInstallUrl } from "./extension-install";
import type { OnboardingAction, OnboardingStep, Platform } from "./onboarding.types";

interface StepCopy {
	title: string;
	description: string;
	actions: OnboardingAction[];
}

const INSTALL_BROWSER_DESCRIPTION =
	"Add Readplace to your browser and log-in so you can save any page with one click.";

const INSTALL_COPY: Record<Platform, StepCopy> = {
	firefox: {
		title: "Install the Firefox browser extension",
		description: INSTALL_BROWSER_DESCRIPTION,
		actions: [{ label: "Install", url: buildExtensionInstallUrl("firefox") }],
	},
	chrome: {
		title: "Install the Chrome browser extension",
		description: INSTALL_BROWSER_DESCRIPTION,
		actions: [{ label: "Install", url: buildExtensionInstallUrl("chrome") }],
	},
	iphone: {
		title: "Install the Readplace iPhone app",
		description:
			"Add the Readplace iPhone app and sign in so you can save any page from the iOS share sheet.",
		actions: [{ label: "Install", url: buildExtensionInstallUrl("iphone") }],
	},
	other: {
		title: "Install a browser extension",
		description: INSTALL_BROWSER_DESCRIPTION,
		actions: [{ label: "Choose browser", url: buildExtensionInstallUrl("other") }],
	},
};

const SAVE_COPY: Record<Platform, StepCopy> = {
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
		actions: [{ label: "Choose browser", url: buildExtensionInstallUrl("other") }],
	},
};

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
];

export const ONBOARDING_VERSION = createHash("sha256")
	.update(ONBOARDING_STEPS.map((step) => step.id).sort().join("|"))
	.digest("hex")
	.slice(0, 8);

/** Dismiss token for the no-client escape card. Deliberately a fixed string,
 * NOT hashed from the step list like {@link ONBOARDING_VERSION}: a no-client
 * device never sees the steps, so editing them must not rotate this token and
 * re-surface a card the user already dismissed. Never collides with an
 * ONBOARDING_VERSION value (8 hex chars). Bump by hand only if the no-client
 * card's own content changes enough to warrant re-notifying dismissers. */
export const NO_CLIENT_ONBOARDING_VERSION = "no-client";
