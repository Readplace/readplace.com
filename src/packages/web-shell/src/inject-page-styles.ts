import assert from "node:assert";
import { parseHTML } from "linkedom";

/**
 * Inject page-specific CSS as a <style> element inside <main>, so that htmx
 * navigation (hx-target="main" hx-select="main" hx-swap="outerHTML") swaps the
 * page's CSS atomically with its content. Without this, htmx leaves the
 * previous page's <style> stranded in <head>, defacing the new page's layout.
 */
export function injectPageStylesIntoMain(content: string, styles: string): string {
	if (!styles) return content;
	const { document } = parseHTML(`<!DOCTYPE html><html><body>${content}</body></html>`);
	const main = document.querySelector("main");
	assert(main, "PageBody.content must contain a <main> element when styles are provided");
	const styleEl = document.createElement("style");
	styleEl.textContent = styles;
	main.insertBefore(styleEl, main.firstChild);
	return document.body.innerHTML;
}
