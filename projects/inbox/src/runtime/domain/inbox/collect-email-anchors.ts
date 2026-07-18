import assert from "node:assert";
import { parseHTML } from "linkedom";

const MAX_ANCHOR_TEXT_LENGTH = 200;

/** The label the newsletter itself gave each link — the strongest
 * classification signal for wrapper URLs whose destination is opaque. */
export function collectEmailAnchors(html: string): Map<string, string> {
	const { document } = parseHTML(`<html><body>${html}</body></html>`);
	const anchors = new Map<string, string>();
	for (const anchor of document.querySelectorAll("a[href]")) {
		const href = anchor.getAttribute("href");
		assert(href !== null, "a[href] selector must only yield anchors with an href");
		const text = anchor.textContent.replace(/\s+/g, " ").trim().slice(0, MAX_ANCHOR_TEXT_LENGTH);
		if (text === "" || anchors.has(href)) continue;
		anchors.set(href, text);
	}
	return anchors;
}
