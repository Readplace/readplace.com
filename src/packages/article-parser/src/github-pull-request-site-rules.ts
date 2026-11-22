import { noExtract, noRecovery, skipCrawl, type SiteRules } from "@packages/site-rules";

const GITHUB = "https://github.com";
const PR_PATH = /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/pull\/[1-9]\d*\/?$/;
const PR_HEADER = '#diff-comparison-viewer-container header[data-component="SplitPageLayout.Header"]';
const OPENING_BODY = '.js-command-palette-pull-body .js-comment[id^="pullrequest-"] .js-comment-body';
const HIDDEN = 'template, [hidden], [aria-hidden="true"], .d-none, .Details-content--hidden';
const REVIEW_EVENT = ".TimelineItem:has(> .TimelineItem-badge :is(.octicon-eye, .octicon-check, .octicon-diff, .octicon-git-merge, .octicon-git-pull-request, .octicon-git-pull-request-closed)) > .TimelineItem-body";

export const githubPullRequestSiteRules = {
	matches: ({ url, hostname }) => hostname === "github.com" && PR_PATH.test(new URL(url).pathname),
	onCrawl: skipCrawl,
	recoverContent: noRecovery,
	extract: noExtract,
	transform: ({ document }) => {
		const publicRepo = document.querySelector('meta[name="octolytics-dimension-repository_public"][content="true"]');
		const signedOut = document.querySelector('meta[name="user-login"][content=""]');
		const sourceUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content");
		if (!publicRepo || !signedOut || !sourceUrl?.startsWith(`${GITHUB}/`) || !PR_PATH.test(sourceUrl.slice(GITHUB.length))) return;

		const header = document.querySelector(PR_HEADER);
		const title = header?.querySelector<HTMLElement>('[data-component="TitleArea"] h1 > span:not(.sr-only)')?.innerText.trim();
		const state = header?.querySelector<HTMLElement>('[data-component="StateLabel"]')?.innerText.trim();
		const discussion = document.querySelector("#diff-comparison-viewer-container .js-discussion");
		const opening = discussion?.querySelector(OPENING_BODY);
		const socialTitle = document.querySelector('meta[property="og:title"]');
		if (!title || !state || !discussion || !opening || opening.closest(HIDDEN) || !socialTitle) return;

		const article = document.createElement("article");
		const heading = document.createElement("h1");
		heading.textContent = title;
		const byline = document.createElement("p");
		byline.textContent = state;
		for (const tab of document.querySelectorAll(`${PR_HEADER} a:is([href$="/commits"], [href$="/files"])`)) {
			byline.append(" · ", tab.cloneNode(true));
		}
		article.append(heading, byline);

		const renderedThreads = new Set<Element>();
		for (const entry of discussion.querySelectorAll(`.js-comment-body, ${REVIEW_EVENT}`)) {
			if (entry.closest(HIDDEN)) continue;
			if (entry.matches(REVIEW_EVENT)) {
				article.append(renderTimelineEvent(entry));
				continue;
			}
			const byline = renderAuthor(entry);
			if (!byline) return;
			const thread = entry.closest(".review-thread-component");
			if (thread && !renderedThreads.has(thread)) {
				const context = renderDiff(thread);
				if (!context) return;
				article.append(context);
				renderedThreads.add(thread);
			}
			const body = document.importNode(entry, true);
			prepareMarkdown(body);
			article.append(byline, ...body.childNodes);
		}

		// GitHub's fragment targets belong to the publisher's page.
		for (const anchor of article.querySelectorAll('a[href^="#"]')) {
			anchor.setAttribute("href", sourceUrl + anchor.getAttribute("href"));
		}

		socialTitle.setAttribute("content", title);
		document.title = title;
		document.body.replaceChildren(article);
	},
} satisfies SiteRules;

function renderAuthor(body: Element): Element | undefined {
	const comment = body.closest(".js-comment");
	if (!comment) return undefined;
	const author = comment.querySelector<HTMLAnchorElement>("a.author[href]");
	const timestamp = comment.querySelector("relative-time[datetime]");
	const sourcePermalink = timestamp?.closest<HTMLAnchorElement>("a[href]");
	if (!author || !timestamp || !sourcePermalink) return undefined;

	const document = body.ownerDocument;
	const link = document.createElement("a");
	link.href = author.href;
	link.textContent = author.innerText.trim();
	const permalink = document.createElement("a");
	permalink.href = sourcePermalink.href;
	const time = document.createElement("time");
	time.textContent = timestamp.getAttribute("datetime");
	permalink.append(time);

	const byline = document.createElement("p");
	byline.append(link);
	const badge = comment.querySelector<HTMLElement>("a.author + .Label");
	if (badge?.innerText.trim() === "Bot") byline.append(" (Bot)");
	byline.append(" · ", permalink);
	return byline;
}

function prepareMarkdown(body: Element): void {
	for (const control of body.querySelectorAll(`${HIDDEN}, button, script, style`)) control.remove();
	for (const checkbox of body.querySelectorAll('input[type="checkbox"]')) {
		checkbox.replaceWith(checkbox.hasAttribute("checked") ? "[x] " : "[ ] ");
	}
	// The reader's HTML allowlist has no interactive disclosure tags.
	for (const detail of Array.from(body.querySelectorAll("details")).reverse()) {
		for (const summary of detail.querySelectorAll(":scope > summary")) {
			const label = body.ownerDocument.createElement("p");
			label.append(...summary.childNodes);
			summary.replaceWith(label);
		}
		detail.replaceWith(...detail.childNodes);
	}
}

function renderTimelineEvent(entry: Element): Element {
	const event = entry.ownerDocument.createElement("p");
	event.innerHTML = entry.innerHTML;
	for (const control of event.querySelectorAll(`${HIDDEN}, button, tool-tip, svg, .sr-only, a:has(img.avatar)`)) control.remove();
	for (const author of event.querySelectorAll("a.author")) author.removeAttribute("class");
	for (const wrapper of event.querySelectorAll("div")) wrapper.replaceWith(" ", ...wrapper.childNodes, " ");
	for (const relativeTime of event.querySelectorAll("relative-time[datetime]")) {
		const time = entry.ownerDocument.createElement("time");
		time.textContent = relativeTime.getAttribute("datetime");
		relativeTime.replaceWith(time);
	}
	return event;
}

function renderDiff(thread: Element): Element | undefined {
	const file = thread.querySelector("a.text-mono[href]");
	const rows = thread.querySelectorAll(".diff-table tr");
	if (!file || rows.length === 0) return undefined;

	const lines: string[] = [];
	for (const row of rows) {
		const numbers = row.querySelectorAll(".blob-num");
		const cell = row.querySelector(".blob-code");
		const code = cell?.querySelector(".blob-code-inner");
		if (numbers.length !== 2 || !cell || !code) return undefined;
		const lineNumbers = Array.from(numbers, (side) => side.getAttribute("data-line-number"));
		const marker = cell.classList.contains("blob-code-addition") ? "+" : cell.classList.contains("blob-code-deletion") ? "-" : " ";
		lines.push(`${lineNumbers.join("/")} ${marker}${code.textContent}`);
	}

	const document = thread.ownerDocument;
	const block = document.createElement("section");
	const fileName = document.createElement("p");
	fileName.append(file.cloneNode(true));
	for (const status of thread.querySelectorAll<HTMLElement>(`a.text-mono[href] + span.Label.Label--warning:not(${HIDDEN})`)) {
		fileName.append(" · ", status.innerText.trim());
	}
	const pre = document.createElement("pre");
	const code = document.createElement("code");
	code.textContent = lines.join("\n");
	pre.append(code);
	block.append(fileName, pre);
	return block;
}
