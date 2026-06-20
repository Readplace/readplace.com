import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@packages/web-shell";
import type { PageBody } from "@packages/web-shell";

import { SAVE_ERROR_STYLES } from "./save-error.styles";

const SAVE_ERROR_TEMPLATE = readFileSync(join(__dirname, "save-error.template.html"), "utf-8");

const COUNTDOWN_SECONDS = 5;

const COUNTDOWN_SCRIPT = `<script src="/client-dist/save-error.client.js" defer></script>`;

export function SaveErrorPage(input: { redirectUrl: string; linkLabel: string }): PageBody {
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
			seconds: COUNTDOWN_SECONDS,
			redirectUrl: input.redirectUrl,
			linkLabel: input.linkLabel,
		}) },
		scripts: COUNTDOWN_SCRIPT,
	};
}
