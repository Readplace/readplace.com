import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, renderAlert, withInternalTracking } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { SAVE_ERROR_STYLES } from "./save-error.styles";

const SAVE_ERROR_TEMPLATE = readFileSync(join(__dirname, "save-error.template.html"), "utf-8");

const COUNTDOWN_SECONDS = 5;

const COUNTDOWN_SCRIPT = `<script src="/client-dist/save-error.client.js" defer></script>`;

export function readerErrorLink(input: {
	signedIn: boolean;
	source: "save-error" | "view-error";
}): { redirectUrl: string; linkLabel: string } {
	return {
		redirectUrl: withInternalTracking(input.signedIn ? "/queue" : "/", {
			source: input.source,
			content: input.signedIn ? "back-to-queue" : "home",
		}),
		linkLabel: input.signedIn ? "Go to your readlist" : "Go to homepage",
	};
}

export function SaveErrorPage(input: {
	redirectUrl: string;
	linkLabel: string;
	title: string;
	statusCode?: number;
}): PageBody {
	const messageHtml = render(
		'Redirecting in <span class="save-error__seconds" data-countdown-seconds="{{seconds}}">{{seconds}}</span> seconds...',
		{ seconds: COUNTDOWN_SECONDS },
	);
	const alertHtml = renderAlert({
		key: "save-error",
		content: {
			variant: "error",
			title: { text: input.title, element: "h1" },
			message: { html: messageHtml },
		},
	});
	return {
		seo: {
			title: "No URL provided — Readplace",
			description: "The save link is missing a URL parameter.",
			canonicalUrl: "https://readplace.com/save",
			robots: "noindex, nofollow",
		},
		styles: SAVE_ERROR_STYLES,
		bodyClass: "page-save-error",
		content: { html: render(SAVE_ERROR_TEMPLATE, {
			refreshDelay: COUNTDOWN_SECONDS,
			alertHtml,
			redirectUrl: input.redirectUrl,
			linkLabel: input.linkLabel,
		}) },
		scripts: COUNTDOWN_SCRIPT,
		statusCode: input.statusCode,
	};
}
