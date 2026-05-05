import { createHash } from "node:crypto";
import { buildExtensionInstallUrl } from "./extension-install";
import type { OnboardingStep } from "./onboarding.types";

const BROWSER_LABELS: Record<string, string> = {
	firefox: "Firefox",
	chrome: "Chrome",
};

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
	{
		id: "install-extension",
		title: (ctx) => {
			const label = BROWSER_LABELS[ctx.browser];
			return label
				? `Install the ${label} browser extension`
				: "Install a browser extension";
		},
		description:
			"Add Readplace to your browser so you can save any page with one click.",
		derivable: true,
		isComplete: (ctx) => ctx.extensionInstalled,
		isApplicable: (ctx) => !ctx.isMobile,
		actions: (ctx) => [{
			label: BROWSER_LABELS[ctx.browser] ? "Install" : "Choose browser",
			url: buildExtensionInstallUrl(ctx.browser),
		}],
	},
	{
		id: "save-via-extension",
		title: () => "Save your first article with the extension",
		description:
			"Press the Readplace button on any page you want to read later. The extension captures the page directly from your browser, so anti-bot protections can't block it.",
		derivable: false,
		isComplete: (ctx) => ctx.savedViaExtension,
	},
];

/**
 * The version hash is derived from the step IDs. Renaming or adding a step
 * invalidates every existing dismiss cookie (by design — a renamed step has
 * different meaning, and a new step is fresh work for the user). The Phase 2
 * rename of save-first-article → save-via-extension intentionally re-opens the
 * checklist for users who dismissed the old version.
 */
export const ONBOARDING_VERSION = createHash("sha256")
	.update(ONBOARDING_STEPS.map((step) => step.id).sort().join("|"))
	.digest("hex")
	.slice(0, 8);
