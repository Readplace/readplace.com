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
			"Add Readplace to your browser and log-in so you can save any page with one click.",
		isComplete: (ctx) => ctx.extensionInstalled,
		actions: (ctx) => [{
			label: BROWSER_LABELS[ctx.browser] ? "Install" : "Choose browser",
			url: buildExtensionInstallUrl(ctx.browser),
		}],
	},
	{
		id: "save-first-article",
		title: () => "Save your first article",
		description:
			"Paste a URL to save, or press your browser extension button on any page you want to read later to save the current tab to your reading list. Saving via the extension is more reliable — it captures the page directly from your browser, so anti-bot protections can't block the content from being retrieved.",
		isComplete: (ctx) => ctx.savedArticleCount > 0,
	},
];

export const ONBOARDING_VERSION = createHash("sha256")
	.update(ONBOARDING_STEPS.map((step) => step.id).sort().join("|"))
	.digest("hex")
	.slice(0, 8);
