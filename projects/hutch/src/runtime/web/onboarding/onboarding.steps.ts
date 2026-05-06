import { createHash } from "node:crypto";
import { buildExtensionInstallUrl } from "./extension-install";
import type { OnboardingStep } from "./onboarding.types";

const BROWSER_LABELS: Record<string, string> = {
	firefox: "Firefox",
	chrome: "Chrome",
};

/** TODO: Remove the `ctx.browser === "chrome"` short-circuits below once Chrome
 * extension v1.0.108+ is published to the web store, then revert this file to
 * the pre-bypass version. The bypass auto-marks both onboarding steps complete
 * for Chrome users so they can reach the success state without the unreleased
 * extension cookies firing.
 * https://chromewebstore.google.com/detail/hutch-%E2%80%94-save-articles-rea/klblengmhlfnmjoagchagfcdbpbocgbf
 */
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
		isComplete: (ctx) => ctx.browser === "chrome" || ctx.extensionInstalled,
		actions: (ctx) => [{
			label: BROWSER_LABELS[ctx.browser] ? "Install" : "Choose browser",
			url: buildExtensionInstallUrl(ctx.browser),
		}],
	},
	{
		id: "save-first-article-via-extension",
		title: (ctx) =>
			ctx.browser !== "other"
				? "Save your first article using the browser extension"
				: "Save your first article using a browser extension",
		description:
			"Click the Readplace button in your browser toolbar on a page you want to read later. The save bar on this page doesn't count for this step.",
		isComplete: (ctx) => ctx.browser === "chrome" || ctx.extensionSavedArticle,
		actions: (ctx) =>
			ctx.browser !== "other"
				? []
				: [{ label: "Choose browser", url: buildExtensionInstallUrl(ctx.browser) }],
	},
];

export const ONBOARDING_VERSION = createHash("sha256")
	.update(ONBOARDING_STEPS.map((step) => step.id).sort().join("|"))
	.digest("hex")
	.slice(0, 8);
