import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_CSS_VARIABLES, HtmlPage, render } from "@packages/web-shell";
import type { Component, CspNonce } from "@packages/web-shell";

import type { NativeClientPlatform } from "../../onboarding/native-client";
import { buildShareDemoVideo } from "../../shared/share-demo-video";

const HELP_ADD_LINKS_TEMPLATE = readFileSync(
	join(__dirname, "add-links.template.html"),
	"utf-8",
);

interface PinCopy {
	title: string;
	lead: string;
	steps: readonly string[];
	demoLabel: string | undefined;
}

const PIN_COPY = {
	ios: {
		title: "Pin Readplace to the share row",
		lead: "iOS buries new apps at the end of the share row. Favourite Readplace once and it moves to the front.",
		steps: [
			"Tap Share, then scroll the app row right and tap More.",
			"Tap Edit.",
			"Tap the + beside Readplace, then Done.",
		],
		demoLabel:
			"Saving a page to Readplace from the iOS share sheet, and moving Readplace to the front of the share row",
	},
	android: {
		title: "Pin Readplace in the share sheet",
		lead: "Android sorts the share sheet by what you share to most. Pin Readplace once and it leads the app list.",
		steps: [
			"Tap Share, then find Readplace in the app list.",
			"Press and hold Readplace.",
			"Tap Pin Readplace.",
		],
		demoLabel: undefined,
	},
} satisfies Record<NativeClientPlatform, PinCopy>;

const PIN_COPY_WITHOUT_PLATFORM_MARKER = PIN_COPY.ios;

export function HelpAddLinksPage(params: {
	staticBaseUrl: string;
	cspNonce: CspNonce;
	platform: NativeClientPlatform | undefined;
	/** The app-shell "Back to queue" deep link, rendered only when the page is
	 * hosted in an app web sheet (`?shell=app`). A browser visitor gets no link —
	 * the `readplace://` scheme would be a dead end there — so the page keeps its
	 * bare public shape by default. Mirrors the account page, the other chromeless
	 * surface the same sheet hosts, so both read "Back to queue". */
	backLink?: { href: string; label: string };
}): Component {
	const copy = params.platform
		? PIN_COPY[params.platform]
		: PIN_COPY_WITHOUT_PLATFORM_MARKER;
	return HtmlPage(
		render(HELP_ADD_LINKS_TEMPLATE, {
			cspNonce: params.cspNonce,
			baseStyles: BASE_CSS_VARIABLES,
			backLink: params.backLink,
			// The chromeless sheet ignores the safe area, so the app variant hard-codes
			// the bottom pad that clears the home indicator (see the stylesheet).
			mainClass: params.backLink ? "help help--app" : "help",
			pin: {
				title: copy.title,
				lead: copy.lead,
				steps: copy.steps,
				demo:
					copy.demoLabel === undefined
						? undefined
						: {
								...buildShareDemoVideo(params.staticBaseUrl),
								label: copy.demoLabel,
							},
			},
		}),
	);
}
