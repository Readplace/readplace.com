import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, withInternalTracking } from "@packages/web-shell";

export { ARTICLE_HIGHLIGHT_CLASS } from "./article-highlight-class";

const HIGHLIGHT_TOOLBAR_TEMPLATE = readFileSync(join(__dirname, "highlight-toolbar.template.html"), "utf-8");

export const HIGHLIGHT_TOOLBAR_SCRIPT = '<script src="/client-dist/highlight-toolbar.client.js" defer></script>';

export function renderHighlightToolbar(input: { createUrl: string }): string {
	return render(HIGHLIGHT_TOOLBAR_TEMPLATE, {
		createUrl: withInternalTracking(input.createUrl, { source: "highlight-toolbar", content: "highlight" }),
	}).trim();
}
