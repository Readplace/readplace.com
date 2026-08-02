import assert from "node:assert";

/**
 * Inject a page's own script bundle references at the END of <main> (before
 * </main>), so an htmx boosted navigation (hx-target="main" hx-select="main")
 * re-runs them on arrival. htmx clones and executes scripts inside the swapped
 * subtree but discards everything outside it, so a page bundle emitted at the
 * end of <body> would silently not run after a boost — collapsing the reader
 * iframe, disabling clipboard buttons, etc. End of <main>, not the start, so an
 * inline page script still parses after the content it queries on a full load.
 *
 * String insert, NOT a DOM parse — a parse/serialize round-trip decodes one
 * level of HTML escaping and would collapse the reader iframe's intentionally
 * double-escaped srcdoc (the same reason injectPageStylesIntoMain is
 * string-based; see web-shell biome.json). Global scripts (htmx, siteScripts)
 * must stay outside <main> so they load once, not on every swap.
 */
export function injectPageScriptsIntoMain(content: string, scripts: string): string {
	if (!scripts) return content;
	const updated = content.replace(/<\/main\s*>/i, (closeTag) => scripts + closeTag);
	assert(updated !== content, "PageBody.content must contain a <main> element when scripts are provided");
	return updated;
}
