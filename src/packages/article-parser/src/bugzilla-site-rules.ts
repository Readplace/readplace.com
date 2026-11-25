import { noRecovery, noTransform, skipCrawl, type SiteArticleContent, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";

const ISSUE_URL = /^https:\/\/bugzilla\.mozilla\.org\/show_bug\.cgi\?id=([1-9]\d*)(?:&utm_[a-z_]+=[^&#]*)*(?:#.*)?$/;
const ORIGIN = "https://bugzilla.mozilla.org";
const PROFILE_URL = /^https:\/\/bugzilla\.mozilla\.org\/user_profile\?user_id=[1-9]\d*$/;
const OMITTED = 'template, details, dialog, script, style, form, button, input, textarea, [hidden], [inert], [aria-hidden="true" i], .bz_private, .bz_default_hidden, .edit-show, .name-info-popup';
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\.0+)?)\s*(?:!important\s*)?(?:;|$)/i;
const ABSOLUTE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} (?:PDT|PST|UTC)$/;

export const bugzillaSiteRules = {
	matches: ({ url }) => ISSUE_URL.test(url),
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	transform: noTransform,
	extract: ({ html }, { savedUrl, documentUrl }): SiteArticleContent | undefined => {
		const id = issueId(savedUrl);
		if (!id || id !== issueId(documentUrl)) return undefined;

		const { document } = parseHTML(html);
		const canonicals = document.querySelectorAll<HTMLLinkElement>('head > link[rel="canonical"][href]');
		const social = document.querySelectorAll<HTMLMetaElement>('head > meta[property="og:url"]');
		if (canonicals.length !== 1 || social.length !== 1) return undefined;
		const canonical = canonicals[0].href;
		if (issueId(canonical) !== id || social[0].content !== canonical) return undefined;

		// A browser capture or mirror can carry issue markup. Require the signed-out
		// shell and a complete, visible timeline before replacing the default parse.
		const events = [...document.querySelectorAll("div.change-set")];
		for (const element of document.querySelectorAll(OMITTED)) element.remove();
		for (const element of document.querySelectorAll<HTMLElement>("[style]")) {
			if (HIDDEN_STYLE.test(element.style.cssText)) element.remove();
		}
		if (!document.querySelector('head > meta[name="generator"][content^="Bugzilla "]') ||
			!document.querySelector("#header #header-login #login_link_top") ||
			document.querySelector('#header a[href*="logout="]')) return undefined;
		const scopes = document.querySelectorAll("body.bugzilla-mozilla-org.bug_modal main#bugzilla-body > #main-inner");
		const lastEvent = events.at(-1);
		if (scopes.length !== 1 || !lastEvent || events[0].id !== "c0" || new Set(events.map((event) => event.id)).size !== events.length) return undefined;
		const scope = scopes[0];
		const end = scope.querySelector(":scope > #bottom-actions");
		if (!end || !(lastEvent.compareDocumentPosition(end) & 4)) return undefined;
		const comments = events.filter(event => /^c[0-9]+$/.test(event.id));
		if (comments.some((event, ordinal) => event.id !== `c${ordinal}`)) return undefined;

		const article = document.createElement("article");
		const title = appendIssueSummary(article, scope, events[0], canonical, id);
		if (!title) return undefined;
		for (const event of events) {
			if (event.parentElement !== scope || !appendEvent(article, event, canonical, id)) return undefined;
		}
		return { title, bodyHtml: article.innerHTML };
	},
} satisfies SiteRules;

function issueId(url: string): string | undefined {
	return ISSUE_URL.exec(url)?.[1];
}

function linkTarget(element: Element, canonical: string): URL | null {
	const href = element.getAttribute("href");
	if (!href) return null;
	const url = URL.parse(href, canonical);
	if (!url || !["https:", "http:", "mailto:"].includes(url.protocol) || url.username || url.password) return null;
	return url;
}

function link(document: Document, target: URL, text: string | null): HTMLAnchorElement {
	const element = document.createElement("a");
	element.href = target.href;
	element.textContent = text;
	return element;
}

function copyIssueLinkTitle(output: Element, source: Element, target: URL): void {
	const title = source.getAttribute("title");
	if (title?.trim() && source.classList.contains("bz_bug_link") && issueId(target.href)) {
		output.setAttribute("title", title);
	}
}

function paragraph(article: Element, ...content: Array<string | Element>): void {
	const line = article.ownerDocument.createElement("p");
	line.append(...content);
	article.append(line);
}

function timestamp(stamp: Element | null): HTMLTimeElement | undefined {
	const title = stamp?.getAttribute("title");
	const seconds = stamp?.getAttribute("data-time");
	if (!stamp || !title || !ABSOLUTE_DATE.test(title) || !seconds || !/^\d+$/.test(seconds)) return undefined;
	const offset = (Number(seconds) * 1000 - Date.parse(title)) / 1000;
	if (!(offset >= 0 && offset < 60)) return undefined;
	const time = stamp.ownerDocument.createElement("time");
	time.textContent = title;
	return time;
}

function appendIssueSummary(article: Element, scope: Element, opening: Element, canonical: string, id: string): string | undefined {
	const title = text(scope, "#summary-container h1#field-value-short_desc");
	const issues = scope.querySelectorAll<HTMLElement>("#summary-container #field-value-bug_id > a[href]");
	if (issues.length !== 1) return undefined;
	const issue = issues[0];
	const badge = text(scope, "#summary-container #field-value-status_summary .bug-status-label");
	const status = text(scope, "#field-status-view #field-value-status-view");
	const url = linkTarget(issue, canonical);
	if (!title || issue.innerText.trim() !== `Bug ${id}` || !url || issueId(url.href) !== id || !badge || !status) return undefined;
	paragraph(article, link(article.ownerDocument, url, issue.innerText.trim()), ` · ${badge}`);
	paragraph(article, `Status: ${status}`);

	const dates = scope.querySelectorAll("#summary-container .bug-time-label");
	if (dates.length !== 2) return undefined;
	for (const [index, label] of ["Opened", "Updated"].entries()) {
		const node = dates[index];
		const time = timestamp(node.querySelector(":scope > .rel-time"));
		if (!time || node.firstChild?.textContent?.trim() !== label) return undefined;
		paragraph(article, `${label} `, time);
	}

	for (const [label, selector] of [
		["Product", "#field-product #product-name"],
		["Component", "#field-component #component-name"],
		["Type", "#field-bug_type #field-value-bug_type .bug-type-label"],
		["Priority", "#field-priority #field-value-priority"],
		["Severity", "#field-bug_severity #field-value-bug_severity"],
		["Tracking", "#module-tracking header #module-tracking-subtitle"],
		["Details", "#module-details header #module-details-subtitle"],
	]) {
		const value = text(scope, selector);
		if (value && (label !== "Tracking" || !/^\(\s*\)$/.test(value))) {
			paragraph(article, `${label}: ${value.replace(/\s+/g, " ")}`);
		}
	}
	const people = scope.querySelectorAll<HTMLElement>(":scope > section#module-people > header h3#module-people-subtitle");
	const reporter = text(opening, ":scope > .comment .change-author a.email > .fna");
	const role = text(opening, ":scope > .comment .change-author > .user-role");
	// The public people heading declares the assignment even when its fields are collapsed.
	if (people.length === 1 && !people[0].children.length && reporter && role === "Reporter" &&
		people[0].innerText.trim() === `(Reporter: ${reporter}, Unassigned)`) {
		paragraph(article, "Assignee: Unassigned");
	}
	return title;
}

function text(scope: ParentNode, selector: string): string | undefined {
	return scope.querySelector<HTMLElement>(selector)?.innerText.trim();
}

function appendEvent(article: Element, event: Element, canonical: string, id: string): boolean {
	const heads = event.querySelectorAll<HTMLElement>(":scope > div.comment, :scope > div.change");
	if (heads.length !== 1 || event.className !== "change-set") return false;
	const head = heads[0];
	const label = head.querySelector<HTMLElement>(".change-name > a");
	const author = head.querySelector(".change-author a.email");
	const name = text(head, ".change-author a.email > .fna");
	const target = label && linkTarget(label, canonical);
	const profile = author && linkTarget(author, canonical);
	const time = timestamp(head.querySelector(".change-time > .rel-time"));
	if (!label || !target || issueId(target.href) !== id || target.hash !== `#${event.id}` || !name || !profile || !PROFILE_URL.test(profile.href) || !time) return false;

	const document = article.ownerDocument;
	const nameLine = document.createElement("h3");
	const title = label.innerText.trim();
	nameLine.append(link(document, target, title), " · ", link(document, profile, name));
	const role = text(head, ".change-author > .user-role");
	if (role) nameLine.append(` (${role})`);
	article.append(nameLine);
	paragraph(article, time);

	const bodies = event.querySelectorAll<HTMLElement>(":scope > div.comment-text");
	const activities = event.querySelectorAll(":scope > div.activity");
	if (bodies.length > 1 || activities.length > 1) return false;
	const [body] = bodies;
	const [activity] = activities;
	if (head.className === "comment") {
		const number = head.getAttribute("data-no");
		const commentId = head.getAttribute("data-id");
		if (!number || !/^\d+$/.test(number) || !commentId || event.id !== `c${number}` || title !== (number === "0" ? "Description" : `Comment ${number}`)) return false;
		if (!body || body.getAttribute("data-comment-id") !== commentId || !body.innerText.trim()) return false;
		const cards = event.querySelectorAll<HTMLElement>(":scope > .attachment");
		if (cards.length === 1) {
			const attachment = publicAttachment(cards[0], canonical);
			if (attachment) paragraph(article, "Attachment: ", attachment);
		}
		if (body.className === "comment-text") {
			const pre = document.createElement("pre");
			// A span also keeps the browser from dropping an initial newline in the pre.
			const line = document.createElement("span");
			if (!appendInline(line, body, canonical)) return false;
			pre.append(line);
			article.append(pre);
		} else if (body.className === "comment-text markdown-body") {
			const rich = document.createElement("div");
			if (!appendRich(rich, body, "root", canonical)) return false;
			article.append(rich);
		} else {
			return false;
		}
	} else if (head.className !== "change" || body || !activity || title !== "Updated" || !/^a\d+_\d+$/.test(event.id) || head.id !== `a${event.id}`) {
		return false;
	}

	if (activity) {
		if (!activity.children.length) return false;
		const list = document.createElement("ul");
		for (const detail of activity.querySelectorAll<HTMLElement>(":scope > *")) {
			const item = document.createElement("li");
			if (detail.className !== "change" || !detail.innerText.trim() || !appendInline(item, detail, canonical, { omitEditLink: true })) return false;
			list.append(item);
		}
		article.append(list);
	}
	return true;
}

function appendInline(output: Element, source: Element, canonical: string, options?: { omitEditLink: boolean }): boolean {
	// Bugzilla's public comment and activity fields have plain text and links.
	// Rebuild the links and keep the original text nodes, including whitespace.
	for (const child of [...source.children]) {
		if (child.localName !== "a" || child.children.length > 0) return false;
		const target = linkTarget(child, canonical);
		if (!target) return false;
		if (target.origin === ORIGIN && target.pathname === "/attachment.cgi") {
			if (!options?.omitEditLink || target.searchParams.get("action") !== "edit") return false;
			child.replaceWith(...child.childNodes);
			continue;
		}
		const anchor = link(output.ownerDocument, target, child.textContent);
		copyIssueLinkTitle(anchor, child, target);
		child.replaceWith(anchor);
	}
	output.append(...[...source.childNodes].filter((child) => child.nodeType !== 8));
	return true;
}

function publicAttachment(card: HTMLElement, canonical: string): HTMLAnchorElement | undefined {
	if (card.className !== "attachment patch") return undefined;
	const id = card.getAttribute("data-id");
	const anchors = card.querySelectorAll<HTMLElement>(":scope > .label > a.link[href]");
	if (!id || !/^[1-9]\d*$/.test(id) || card.id !== `att-${id}` || anchors.length !== 1) return undefined;
	const anchor = anchors[0];
	const target = linkTarget(anchor, canonical);
	if (!target || target.origin !== ORIGIN || target.pathname !== "/attachment.cgi" ||
		target.searchParams.getAll("id").length !== 1 || target.searchParams.get("id") !== id ||
		target.searchParams.getAll("action").length !== 1 || target.searchParams.get("action") !== "diff" ||
		[...target.searchParams.keys()].length !== 2 || !anchor.innerText.trim()) return undefined;
	return link(card.ownerDocument, target, anchor.innerText.trim());
}

const RICH_CHILDREN = {
	root: ["p", "pre", "ul", "ol"],
	p: ["strong", "code", "a", "br"],
	pre: ["code"],
	ul: ["li"],
	ol: ["li"],
	li: ["strong", "code", "a", "br", "p", "ul", "ol"],
	strong: ["code", "a", "br"],
	code: [],
	a: ["strong", "code"],
	br: [],
} as const;

type RichTag = keyof typeof RICH_CHILDREN;

function isRichTag(name: string): name is RichTag {
	return Object.hasOwn(RICH_CHILDREN, name);
}

function isText(node: ChildNode): node is Text {
	return node.nodeType === 3;
}

function isElement(node: ChildNode): node is Element {
	return node.nodeType === 1;
}

function appendRich(output: Element, source: Element, container: RichTag, canonical: string): boolean {
	const document = output.ownerDocument;
	let previousWasBreak = false;
	for (const node of source.childNodes) {
		if (isText(node)) {
			if (node.data.trim()) {
				if (container === "root" || container === "ol" || container === "ul") return false;
				previousWasBreak = false;
			}
			output.append(node.data);
			continue;
		}
		if (!isElement(node)) continue;
		const name = node.localName;
		if (!isRichTag(name) || !RICH_CHILDREN[container].some(tag => tag === name)) return false;
		const child = document.createElement(name);
		if (name === "a") {
			const target = linkTarget(node, canonical);
			if (!target || (target.origin === ORIGIN && target.pathname === "/attachment.cgi")) return false;
			child.setAttribute("href", target.href);
			copyIssueLinkTitle(child, node, target);
		}
		if (!appendRich(child, node, name, canonical)) return false;
		if (name === "br" && previousWasBreak) {
			// Readability turns adjacent breaks into paragraphs, including inside
			// a publisher's existing paragraph. An inline wrapper keeps the breaks.
			const separator = document.createElement("span");
			separator.append(child);
			output.append(separator);
		} else {
			output.append(child);
		}
		previousWasBreak = name === "br";
	}
	return true;
}
