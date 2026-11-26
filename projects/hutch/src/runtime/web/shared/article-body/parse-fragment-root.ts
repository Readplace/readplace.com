import assert from "node:assert";
import { parseHTML } from "linkedom";

export function parseFragmentRoot(html: string): Element {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="fragment-root">${html}</div></body></html>`,
	);
	const root = document.querySelector("div#fragment-root");
	assert(root, "parseHTML must produce the fragment wrapper div");
	return root;
}
