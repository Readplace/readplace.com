import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HtmlPage, render } from "@packages/web-shell";
import type { Component, CspNonce } from "@packages/web-shell";

import { buildShareDemoVideo } from "../../shared/share-demo-video";

const HELP_ADD_LINKS_TEMPLATE = readFileSync(
	join(__dirname, "add-links.template.html"),
	"utf-8",
);

export function HelpAddLinksPage(params: {
	staticBaseUrl: string;
	cspNonce: CspNonce;
	/** The app-shell "Back to queue" deep link, rendered only when the page is
	 * hosted in the iOS web sheet (`?shell=app`). A browser visitor gets no link —
	 * the `readplace://` scheme would be a dead end there — so the page keeps its
	 * bare public shape by default. Mirrors the account page, the other chromeless
	 * surface the same sheet hosts, so both read "Back to queue". */
	backLink?: { href: string; label: string };
}): Component {
	return HtmlPage(
		render(HELP_ADD_LINKS_TEMPLATE, {
			cspNonce: params.cspNonce,
			backLink: params.backLink,
			// The chromeless sheet ignores the safe area, so the app variant hard-codes
			// the bottom pad that clears the home indicator (see the stylesheet).
			mainClass: params.backLink ? "help help--app" : "help",
			shareDemo: buildShareDemoVideo(params.staticBaseUrl),
		}),
	);
}
