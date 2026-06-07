import assert from "node:assert";
import { parseHTML } from "linkedom";

/**
 * Rewrite in-article links that point back at our own host so they navigate
 * the reader's own tab (`target="_top"`) instead of opening a new one.
 *
 * The reader body renders inside a sandboxed iframe whose `<base target="_top">`
 * already sends target-less links to the parent tab, but captured article HTML
 * frequently bakes `target="_blank"` into its anchors — for a link back to
 * Readplace that would pop a second Readplace tab instead of navigating in
 * place. External links keep whatever the author wrote.
 *
 * `appHost` is the deployment's own host (readplace.com in prod, the staging
 * host in staging), so the same saved article classifies its links correctly
 * per-environment rather than baking a host in at save time. Only absolute
 * hrefs are matched: a relative href on an external article must not be misread
 * as same-host, and Readability already absolutises article links.
 */
export function keepSameHostLinksInSamePage(input: {
	html: string;
	appHost: string;
}): string {
	const { document } = parseHTML(
		`<!DOCTYPE html><html><body><div id="reader-same-host-root">${input.html}</div></body></html>`,
	);
	const root = document.querySelector("div#reader-same-host-root");
	assert(root, "parseHTML must produce the reader-same-host wrapper div");
	for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
		const href = anchor.getAttribute("href");
		assert(href !== null, "the a[href] selector guarantees an href attribute");
		let host: string;
		try {
			host = new URL(href).host;
		} catch {
			continue;
		}
		if (host === input.appHost) anchor.setAttribute("target", "_top");
	}
	return root.innerHTML;
}
