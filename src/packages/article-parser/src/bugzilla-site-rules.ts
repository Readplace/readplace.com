import { noRecovery, noTransform, skipCrawl, type SiteArticleContent, type SiteRules } from "@packages/site-rules";
import { parseHTML } from "linkedom";

const ISSUE_URL = /^https:\/\/bugzilla\.mozilla\.org\/show_bug\.cgi\?id=([1-9]\d*)(?:&utm_[a-z_]+=[^&#]*)*(?:#.*)?$/;
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
		const scope = document.querySelector("body.bugzilla-mozilla-org.bug_modal main#bugzilla-body > #main-inner");
		if (!scope || events[0]?.id !== "c0" || new Set(events.map((event) => event.id)).size !== events.length) return undefined;

		const article = document.createElement("article");
		const title = appendIssueSummary(article, scope, canonical, id);
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

function appendIssueSummary(article: Element, scope: Element, canonical: string, id: string): string | undefined {
	const title = text(scope, "#summary-container h1#field-value-short_desc");
	const issue = scope.querySelector<HTMLElement>("#summary-container #field-value-bug_id > a[href]");
	const badge = text(scope, "#summary-container #field-value-status_summary .bug-status-label");
	const status = text(scope, "#field-status-view #field-value-status-view");
	const url = issue && linkTarget(issue, canonical);
	if (!title || !issue || issue.innerText.trim() !== `Bug ${id}` || !url || issueId(url.href) !== id || !badge || !status) return undefined;
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
		if (value) paragraph(article, `${label}: ${value.replace(/\s+/g, " ")}`);
	}
	return title;
}

function text(scope: ParentNode, selector: string): string | undefined {
	return scope.querySelector<HTMLElement>(selector)?.innerText.trim();
}

function appendEvent(article: Element, event: Element, canonical: string, id: string): boolean {
	const head = event.querySelector<HTMLElement>(":scope > div.comment, :scope > div.change");
	if (!head || event.className !== "change-set") return false;
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

	const body = event.querySelector<HTMLElement>(":scope > div.comment-text");
	const activity = event.querySelector(":scope > div.activity");
	if (head.className === "comment") {
		const number = head.getAttribute("data-no");
		const commentId = head.getAttribute("data-id");
		if (!number || !/^\d+$/.test(number) || !commentId || event.id !== `c${number}` || title !== (number === "0" ? "Description" : `Comment ${number}`)) return false;
		if (body?.className !== "comment-text" || body.getAttribute("data-comment-id") !== commentId || !body.innerText.trim()) return false;
		const pre = document.createElement("pre");
		// A span also keeps the browser from dropping an initial newline in the pre.
		const line = document.createElement("span");
		if (!appendInline(line, body, canonical)) return false;
		pre.append(line);
		article.append(pre);
	} else if (head.className !== "change" || body || !activity || title !== "Updated" || !/^a\d+_\d+$/.test(event.id) || head.id !== `a${event.id}`) {
		return false;
	}

	if (activity) {
		if (!activity.children.length) return false;
		const list = document.createElement("ul");
		for (const detail of activity.querySelectorAll<HTMLElement>(":scope > *")) {
			const item = document.createElement("li");
			if (detail.className !== "change" || !detail.innerText.trim() || !appendInline(item, detail, canonical)) return false;
			list.append(item);
		}
		article.append(list);
	}
	return true;
}

function appendInline(output: Element, source: Element, canonical: string): boolean {
	// Bugzilla's public comment and activity fields have plain text and links.
	// Rebuild the links and keep the original text nodes, including whitespace.
	for (const child of [...source.children]) {
		if (child.localName !== "a" || child.children.length > 0) return false;
		const target = linkTarget(child, canonical);
		if (!target) return false;
		child.replaceWith(link(output.ownerDocument, target, child.textContent));
	}
	output.append(...[...source.childNodes].filter((child) => child.nodeType !== 8));
	return true;
}
