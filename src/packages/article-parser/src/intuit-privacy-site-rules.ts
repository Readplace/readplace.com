import { noRecovery, noTransform, skipCrawl, type SiteArticleContent, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";

const STATEMENT = new URL("https://www.intuit.com/privacy/statement/");
const ACCORDION = 'div[data-testid="accordion"]';
const ITEM = 'div[data-testid="accordionItem"]';
const BLOCKS = ':scope > div > :is(section#h01-primary-hero, div[data-testid="Container"], div[data-testid="accordion"])';
const INDEPENDENTLY_HIDDEN = '[hidden], [inert], [data-private], [data-edit-only], [contenteditable], .private, .edit-only, .hidden, .sr-only, .visually-hidden, details, dialog, template';
const HIDDEN = `${INDEPENDENTLY_HIDDEN}, [aria-hidden="true" i]`;
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|(?:content-)?visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0+)?%?|height\s*:\s*0(?:px)?)\s*(?:!important\s*)?(?:;|$)/i;
const FADE_STYLE = "transition:opacity 417ms ease 0ms;-webkit-transition:opacity 417ms ease 0ms;opacity:0";
const STATEMENT_DATE = /^Last Updated: [A-Z][a-z]+ \d{1,2}, \d{4}$/;
const POLICY_TAGS = new Set(["a", "b", "br", "em", "h1", "h2", "h3", "h4", "h5", "h6", "i", "li", "ol", "p", "strong", "u", "ul"]);
const WRAPPERS = "div, section, span";
const HERO_MEDIA = 'picture[data-testid="image"], picture[data-testid="image"] > source, picture[data-testid="image"] > img[src][alt]';
const INTRODUCTION_MEDIA = "p > a[href]:has(> img[alt]), p > a[href] > img[alt]";
const MEDIA_ATTRIBUTES = new Set(["src", "srcset", "sizes", "media", "type", "alt", "width", "height", "loading", "target", "rel"]);

export const intuitPrivacySiteRules = {
	matches: ({ url }) => {
		const parsed = new URL(url);
		return parsed.origin === STATEMENT.origin && parsed.pathname === STATEMENT.pathname &&
			parsed.username === "" && parsed.password === "";
	},
	matchFetchedDocument: true,
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	transform: noTransform,
	extract: ({ html }): SiteArticleContent | undefined => {
		const { document } = parseHTML(html);
		const canonical = document.querySelectorAll('head > link[rel="canonical"]');
		if (canonical.length !== 1 || canonical[0].getAttribute("href") !== STATEMENT.href) return undefined;

		const mains = document.querySelectorAll("#main");
		const main = mains[0];
		if (mains.length !== 1 || !main.matches('body[data-theme="icom"] div#main[role="main"]')) return undefined;
		const blocks = main.querySelectorAll(BLOCKS);

		// The public statement has a dated introduction and two disclosure groups.
		// A partial group would omit authored sections, including jurisdiction terms.
		if (blocks.length !== 5) return undefined;
		const [hero, introduction, general, regionalIntroduction, regional] = blocks;
		if (hero.id !== "h01-primary-hero" || !introduction.matches('[data-testid="Container"]') ||
			!general.matches(ACCORDION) || !regionalIntroduction.matches('[data-testid="Container"]') ||
			!regional.matches(ACCORDION)) return undefined;
		if ([...blocks].some(isHiddenInDocument)) return undefined;

		const article = document.createElement("article");
		const titles = hero.querySelectorAll("h1");
		if (titles.length !== 1 || isHiddenInDocument(titles[0])) return undefined;
		const title = visibleText(titles[0]);
		if (!title) return undefined;
		const dates = [...introduction.querySelectorAll("p")].filter(
			(element) => !isHiddenInDocument(element) && STATEMENT_DATE.test(visibleText(element)),
		);
		if (dates.length !== 1) return undefined;

		const labels = new Set<string>();
		titles[0].remove();
		appendPolicyChildren(hero, article, HERO_MEDIA);
		appendPolicyChildren(introduction, article, INTRODUCTION_MEDIA);
		if (!appendDisclosureGroup(general, article, labels, 7)) return undefined;
		appendPolicyChildren(regionalIntroduction, article);
		if (!appendDisclosureGroup(regional, article, labels, 5)) return undefined;
		return { title, bodyHtml: article.innerHTML };
	},
} satisfies SiteRules;

function isHidden(element: Element): boolean {
	return element.matches(HIDDEN) || HIDDEN_STYLE.test(element.getAttribute("style") ?? "");
}

function isHiddenInDocument(element: Element): boolean {
	for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
		if (isHidden(ancestor)) return true;
	}
	return false;
}

function visibleText(source: Element): string {
	const copy = source.ownerDocument.createElement("div");
	appendPolicyChildren(source, copy);
	return copy.innerText.replace(/\s+/g, " ").trim();
}

function appendPolicyChildren(source: Element, target: Element, editorialMedia?: string): void {
	for (const child of source.childNodes) {
		if (child.nodeType === 3) {
			target.append((child as Text).data);
			continue;
		}
		if (child.nodeType !== 1) continue;
		const element = child as Element;
		if (isHidden(element) || element.matches('[role="region"], [data-testid="accordion"]')) continue;
		if (element.matches(WRAPPERS)) {
			appendPolicyChildren(element, target, editorialMedia);
			continue;
		}
		const isEditorialMedia = editorialMedia !== undefined && element.matches(editorialMedia);
		if (!isEditorialMedia && !POLICY_TAGS.has(element.localName)) continue;
		if (isEditorialMedia && element.matches('img:not([src]), img[src=""]')) {
			// The certification anchor's image alternative is its only label.
			target.append((element as HTMLImageElement).alt);
			continue;
		}
		const copy = target.ownerDocument.createElement(element.localName);
		const href = element.getAttribute("href");
		if (element.localName === "a" && href !== null) copy.setAttribute("href", href);
		if (isEditorialMedia) {
			for (const { name, value } of element.attributes) {
				const attribute = name.toLowerCase();
				if (MEDIA_ATTRIBUTES.has(attribute)) copy.setAttribute(attribute, value);
			}
		}
		appendPolicyChildren(element, copy, editorialMedia);
		target.append(copy);
	}
}

function appendDisclosureGroup(group: Element, article: Element, labels: Set<string>, size: number): boolean {
	const expand = group.querySelectorAll(':scope > div[data-testid="accordion-buttons"] > button[data-testid="button-expand"]');
	if (expand.length !== 1 || isDisabled(expand[0]) || isHiddenInDocument(expand[0]) || visibleText(expand[0]) !== "Expand All") return false;

	const items = group.querySelectorAll(`:scope > div > ${ITEM}`);
	if (items.length !== size || group.querySelectorAll(ITEM).length !== size) return false;
	for (const item of items) {
		const [button, region] = item.children;
		if (item.childElementCount !== 2 || !button.matches('button[data-testid="accItemButton"][aria-expanded="false"]') ||
			!region.matches('div[role="region"]') || isDisabled(button) ||
			isHiddenInDocument(button) || isHiddenInDocument(region)) return false;
		if (!reciprocal(button, region)) return false;

		const content = collapsedContent(region);
		const label = visibleText(button);
		if (!content || !label || labels.has(label)) return false;
		labels.add(label);

		const heading = article.ownerDocument.createElement("h2");
		heading.textContent = label;
		article.append(heading);
		const section = article.ownerDocument.createElement("div");
		appendPolicyChildren(content, section);
		if (!section.querySelector("p:not(:empty), li:not(:empty), h1:not(:empty)")) return false;
		article.append(...section.childNodes);
	}
	return true;
}

function isDisabled(button: Element): boolean {
	return button.matches('[disabled], [aria-disabled="true" i], fieldset[disabled] button, form button, button[tabindex="-1"]');
}

function reciprocal(button: Element, region: Element): boolean {
	const document = button.ownerDocument;
	const { id: buttonId } = button;
	const { id: regionId } = region;
	if (!buttonId || !regionId || /\s/.test(buttonId + regionId)) return false;
	if (button.getAttribute("aria-controls") !== regionId || region.getAttribute("aria-labelledby") !== buttonId) return false;
	const ids = [...document.querySelectorAll("[id]")];
	const controls = [...document.querySelectorAll("[aria-controls]")];
	return ids.filter((node) => node.id === buttonId).length === 1 &&
		ids.filter((node) => node.id === regionId).length === 1 &&
		controls.filter((node) => node.getAttribute("aria-controls")?.split(/\s+/).includes(regionId)).length === 1;
}

function collapsedContent(region: Element): Element | undefined {
	const clip = region.firstElementChild;
	if (region.childElementCount !== 1 || !clip?.matches('div[data-testid="animHeight"].rah-static.rah-static--height-zero[aria-hidden="true"]') ||
		clip.getAttribute("style") !== "height:0;overflow:hidden" || clip.matches(INDEPENDENTLY_HIDDEN)) return undefined;
	const fade = clip.firstElementChild;
	if (clip.childElementCount !== 1 || !fade?.matches("div") || fade.matches(HIDDEN) ||
		fade.getAttribute("style") !== FADE_STYLE) return undefined;
	const content = fade.firstElementChild;
	if (fade.childElementCount !== 1 || !content?.matches('div[class^="AccordionItem_content__"]') || isHidden(content)) return undefined;
	return content;
}
