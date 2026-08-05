import { noExtract, noRecovery, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";

/* Site rules for MediaWiki-generated pages — Wikipedia and the wider Wikimedia
 * family (wikimedia.org, mediawiki.org, wikidata.org, …) plus any third-party
 * MediaWiki install (nixos.wiki, …).
 *
 * MediaWiki's Vector-2022 skin wraps every section heading together with an
 * "[edit]" link:
 *
 *   <div class="mw-heading mw-heading2">
 *     <h2>Section title</h2>
 *     <span class="mw-editsection">[<a href="…&action=edit">edit</a>]</span>
 *   </div>
 *
 * That edit anchor gives the wrapper div a non-zero link density, so Mozilla
 * Readability's `_cleanConditionally` "short mostly-link div" rule deletes the
 * whole wrapper — and the <h2> inside it goes too. Saved MediaWiki articles
 * then lose their section headings and carry stray "[edit]" chrome.
 *
 * Removing the `.mw-editsection` spans before Readability scores leaves each
 * wrapper as a plain heading div (link density 0, heading density ~1), which
 * Readability keeps. Verified against real saved pages: The Mythical Man-Month
 * 0→6 headings, Bioluminescence 0→11; pages already intact are untouched
 * (Great Barrier Reef 10→10). The transform only ever removes edit chrome,
 * never body content.
 *
 * `matches` is permissive because MediaWiki runs on hosts far beyond
 * *.wikipedia.org; authoritative detection is the `<meta name="generator"
 * content="MediaWiki …">` tag MediaWiki emits by default, checked in
 * `transform` so a non-MediaWiki page is left untouched. It runs as a
 * `transform`, not an `extract`, so Readability still scores the whole document
 * and picks the article body itself. */
export const mediaWikiSiteRules = {
	matches: (_params: { url: string; hostname: string }) => true,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }) => {
		if (!isMediaWikiPage(document)) return;
		for (const editSection of document.querySelectorAll(".mw-editsection")) {
			editSection.remove();
		}
	},
} satisfies SiteRules;

function isMediaWikiPage(document: Document): boolean {
	const generator = document
		.querySelector('meta[name="generator"]')
		?.getAttribute("content");
	return typeof generator === "string" && generator.startsWith("MediaWiki");
}
