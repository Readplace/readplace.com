import assert from "node:assert";
import { REPEATED_ITEMS, ITEM_MAX_WORDS, ITEM_MIN_WORDS } from "./section-thresholds";
import { CJK_CHARACTER } from "./text-keys";

const CJK_CHARACTERS = new RegExp(CJK_CHARACTER.source, "gu");

const UNOWNED_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"template",
	"svg",
	"iframe",
	"object",
	"embed",
	"canvas",
	"video",
	"audio",
	"form",
	"dialog",
	"button",
	"select",
	"textarea",
	"input",
	"nav",
	"aside",
]);
const UNOWNED_ROLES = new Set(["navigation", "complementary", "banner", "contentinfo", "search", "dialog"]);
const HIDDEN_STYLE = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)\s*(!important\s*)?(;|$)/i;
const ITEM_MARKER = "h1, h2, h3, h4, h5, h6, time";
const LIST_TAGS = new Set(["ul", "ol", "table", "tbody"]);

export function tagOf(el: Element): string {
	return el.tagName.toLowerCase();
}

export function isElement(node: Node): node is Element {
	return node.nodeType === 1;
}

export function isText(node: Node): node is Text {
	return node.nodeType === 3;
}

export function textOf(node: Node): string {
	const text = node.textContent;
	assert(text !== null, "an element or text node always has text content");
	return text;
}

export function isUnowned(el: Element): boolean {
	const tag = tagOf(el);
	return (
		UNOWNED_TAGS.has(tag) ||
		el.hasAttribute("hidden") ||
		el.getAttribute("aria-hidden") === "true" ||
		HIDDEN_STYLE.test(el.getAttribute("style") ?? "") ||
		UNOWNED_ROLES.has(el.getAttribute("role") ?? "") ||
		((tag === "header" || tag === "footer") && el.parentElement?.closest("article") == null)
	);
}

export function isOwnedInDocument(el: Element): boolean {
	for (let node: Element | null = el; node !== null; node = node.parentElement) {
		if (isUnowned(node)) {
			return false;
		}
	}
	return true;
}

export function ownedChildren(el: Element): readonly Element[] {
	return [...el.children].filter((child) => !isUnowned(child));
}

export function countWords(text: string): number {
	return text.replace(CJK_CHARACTERS, " $& ").split(/\s+/).filter((word) => word.length > 0).length;
}

const ownedWordsByElement = new WeakMap<Element, number>();

export function ownedWords(el: Element): number {
	const known = ownedWordsByElement.get(el);
	if (known !== undefined) {
		return known;
	}
	const words = isUnowned(el) ? 0 : [...el.childNodes].reduce((sum, node) => sum + ownedNodeWords(node), 0);
	ownedWordsByElement.set(el, words);
	return words;
}

export function ownedNodeWords(node: Node): number {
	if (isElement(node)) {
		return ownedWords(node);
	}
	return isText(node) ? countWords(node.data) : 0;
}

export function offPageLink(params: { anchor: Element; documentUrl: string }): boolean {
	const href = params.anchor.getAttribute("href");
	if (href === null) {
		return false;
	}
	try {
		const target = new URL(href, params.documentUrl);
		const page = new URL(params.documentUrl);
		target.hash = "";
		page.hash = "";
		return target.href !== page.href;
	} catch {
		return false;
	}
}

function holdsOffPageLink(params: { el: Element; documentUrl: string }): boolean {
	return [...params.el.querySelectorAll("a[href]")].some((anchor) => offPageLink({ anchor, documentUrl: params.documentUrl }));
}

function largestSameTagGroup(items: readonly Element[]): readonly Element[] {
	const groups = new Map<string, Element[]>();
	for (const item of items) {
		groups.set(tagOf(item), [...(groups.get(tagOf(item)) ?? []), item]);
	}
	return [...groups.values()].reduce<readonly Element[]>((largest, group) => (group.length > largest.length ? group : largest), []);
}

export function isLinkedItemGroup(params: { el: Element; documentUrl: string }): boolean {
	const items = ownedChildren(params.el).filter(
		(child) => holdsOffPageLink({ el: child, documentUrl: params.documentUrl }) || child.querySelector(ITEM_MARKER) !== null,
	);
	return largestSameTagGroup(items).length >= REPEATED_ITEMS;
}

function itemLists(el: Element): readonly Element[] {
	const lists = ownedChildren(el).filter((child) => LIST_TAGS.has(tagOf(child)));
	const bodies = lists.flatMap((list) => (tagOf(list) === "table" ? ownedChildren(list).filter((child) => tagOf(child) === "tbody") : []));
	return [el, ...lists, ...bodies];
}

export function isThreadOrTeaserBlock(el: Element): boolean {
	const total = ownedWords(el);
	return itemLists(el).some((list) => {
		const items = ownedChildren(list).filter((child) => {
			const words = ownedWords(child);
			return words >= ITEM_MIN_WORDS && words <= ITEM_MAX_WORDS && child.querySelector(ITEM_MARKER) !== null;
		});
		const group = largestSameTagGroup(items);
		const words = group.reduce((sum, item) => sum + ownedWords(item), 0);
		return group.length >= REPEATED_ITEMS && words * 2 >= total;
	});
}
