import { noExtract, noRecovery, skipCrawl } from "@packages/site-rules";
import type { SiteRules } from "@packages/site-rules";

const ANCHORED_HEADING_CLASS = "header-anchor-post";
const ANCHOR_WIDGET_SELECTOR = ".header-anchor-parent";
const INVISIBLE_CHARACTERS = /[\s\u200B\u2060\uFEFF]/g;

function holdsVisibleText(element: Element): boolean {
	return String(element.textContent).replace(INVISIBLE_CHARACTERS, "") !== "";
}

export const substackSiteRules = {
	matches: (_params: { url: string; hostname: string }) => true,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }) => {
		for (const heading of document.querySelectorAll(`h2.${ANCHORED_HEADING_CLASS}, h3.${ANCHORED_HEADING_CLASS}`)) {
			heading.classList.remove(ANCHORED_HEADING_CLASS);
			if (heading.classList.length === 0) heading.removeAttribute("class");
			for (const widget of heading.querySelectorAll(ANCHOR_WIDGET_SELECTOR)) {
				if (!holdsVisibleText(widget)) widget.remove();
			}
		}
	},
} satisfies SiteRules;
