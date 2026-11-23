import assert from "node:assert/strict";
import { sanitizeArticleHtml } from "@packages/domain/article";
import { parseHTML } from "linkedom";
import { initArticleSiteRules } from "./article-site-rules";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";

const SITE = "https://bugzilla.mozilla.org";
const ISSUE_PATH = "/show_bug.cgi?id=42";
const ISSUE = SITE + ISSUE_PATH;
const TITLE = "Superfluous paint invalidation in the sample renderer";
const OPENED = "2020-01-02 03:04 UTC";
const UPDATED = "2020-01-03 05:06 UTC";
const DESCRIPTION = "The renderer invalidates the entire canvas after each update. This sample shows how to compare two consecutive frames.\n\n  canvas.render({ dirtyRegion: bounds });";
const COMMENT = "The minimal case confirms the affected region extends past the intended boundary.\n\tSee the patch for the updated example.";

function time(date: string): string {
	return `<span class="rel-time" data-time="${Date.parse(date) / 1000 + 17}" title="${date}">years ago</span>`;
}

function eventHead(fragment: string, label: string, date: string, name: string, profile: number, role = "") {
	return `<div class="change-author"><a class="email disabled" href="/user_profile?user_id=${profile}"><span class="fna">${name}</span></a>${role}</div>
		<h3 class="change-name"><a href="${ISSUE_PATH}#${fragment}">${label}</a></h3>
		<div class="change-time">${time(date)}</div>
		<button aria-expanded="true">Collapse</button>`;
}

const FIXTURE = `<!doctype html><html><head><title>Tracker shell</title>
	<link rel="canonical" href="${ISSUE}"><meta property="og:url" content="${ISSUE}"><meta name="generator" content="Bugzilla sample">
	</head><body class="bugzilla-mozilla-org bug_modal">
	<header id="header"><div id="header-login"><a id="login_link_top" href="index.cgi">Log in</a></div></header>
	<main id="bugzilla-body"><div id="main-inner">
		<div id="summary-container">
			<h1 id="field-value-short_desc">${TITLE}</h1>
			<div id="field-value-status_summary"><span class="bug-status-label">Open</span>
				<span id="field-value-bug_id"><a href="${ISSUE_PATH}">Bug 42</a></span>
				<span class="bug-time-label">Opened ${time(OPENED)}</span>
				<span class="bug-time-label">Updated ${time(UPDATED)}</span>
			</div>
		</div>
		<div id="field-status-view"><span id="field-value-status-view">NEW</span></div>
		<div id="field-product"><span id="product-name" style="font-weight: bold">Sample<span aria-hidden="true">▼</span></span><aside class="name-info-popup">Popup text</aside></div>
		<div id="field-component"><span id="component-name">Painting</span></div>
		<div id="field-bug_type"><span id="field-value-bug_type"><span class="bug-type-label">Defect</span></span></div>
		<div id="field-priority"><span id="field-value-priority">P2</span></div>
		<div id="field-bug_severity"><span id="field-value-bug_severity">S3</span></div>
		<section id="module-tracking"><header><h3 id="module-tracking-subtitle">Tracking not set</h3></header></section>
		<section id="module-details"><header><h3 id="module-details-subtitle">Whiteboard: sample issue</h3></header>
			<div class="edit-show">Edit-only issue fields</div></section>
		<section id="module-references" style="display: none !important">Closed reference list</section>
		<div class="change-set" id="c0">
			<div class="comment" data-no="0" data-id="100">${eventHead("c0", "Description", OPENED, "Example Reporter", 11, '<span class="user-role">Reporter</span>')}</div>
			<div class="comment-text" data-comment-id="100">${DESCRIPTION}<span aria-hidden="TRUE">Hidden comment text</span><form><textarea>Comment editor</textarea></form><!-- invisible source note --></div>
		</div>
		<div class="change-set" id="a5_6">
			<div class="change" id="aa5_6">${eventHead("a5_6", "Updated", UPDATED, "Example Maintainer", 12)}</div>
			<div class="activity"><div class="change">Depends on: <a href="/show_bug.cgi?id=81">81</a></div></div>
		</div>
		<div class="change-set" id="c1">
			<div class="comment" data-no="1" data-id="101">${eventHead("c1", "Comment 1", UPDATED, "Example Reporter", 11)}</div>
			<div class="comment-text" data-comment-id="101">The minimal case confirms the affected region extends past the intended boundary.\n\tSee <a href="https://example.com/renderer/patch">the patch</a> for the updated example.</div>
			<div class="activity"><div class="change">Priority: P1 → P2</div></div>
		</div>
	</div></main></body></html>`;

const offline = () => { throw new Error("The parser must use the supplied HTML."); };
const { siteRules } = initArticleSiteRules({ crawlFetch: offline, logError: offline });
const parser = initReadabilityParser({ siteRules, readabilityAdditions, crawlArticle: offline, logError: offline });
const stock = initReadabilityParser({ siteRules: [], readabilityAdditions, crawlArticle: offline, logError: offline });

function parse({ html = FIXTURE, url = `${ISSUE}&utm_source=sample`, documentUrl = ISSUE } = {}) {
	const parsed = parser.parseHtml({ html, url, documentUrl, thumbnailUrl: null });
	assert(parsed.ok);
	const reader = parseHTML(`<html><body>${sanitizeArticleHtml(parsed.article.content)}</body></html>`).document.body;
	return { ...parsed.article, reader };
}

describe("signed-out Mozilla Bugzilla discussion", () => {
	it("keeps the original title, exact comment formatting, ordered authors and history in the reader", () => {
		const { title, reader } = parse();
		expect(title).toBe(TITLE);
		expect(Array.from(reader.querySelectorAll("pre"), (body) => body.textContent)).toEqual([DESCRIPTION, COMMENT]);
		expect(Array.from(reader.querySelectorAll("h3"), (event) => event.textContent)).toEqual([
			"Description · Example Reporter (Reporter)",
			"Updated · Example Maintainer",
			"Comment 1 · Example Reporter",
		]);
		expect(Array.from(reader.querySelectorAll<HTMLAnchorElement>("h3 a"), (link) => link.href)).toEqual([
			`${ISSUE}#c0`, `${SITE}/user_profile?user_id=11`,
			`${ISSUE}#a5_6`, `${SITE}/user_profile?user_id=12`,
			`${ISSUE}#c1`, `${SITE}/user_profile?user_id=11`,
		]);
		expect(Array.from(reader.querySelectorAll("time"), (stamp) => stamp.textContent)).toEqual([OPENED, UPDATED, OPENED, UPDATED, UPDATED]);
		expect(Array.from(reader.querySelectorAll("p:has(time)"), (stamp) => stamp.textContent).slice(0, 2)).toEqual([`Opened ${OPENED}`, `Updated ${UPDATED}`]);
		expect(Array.from(reader.querySelectorAll("li"), (detail) => detail.textContent)).toEqual(["Depends on: 81", "Priority: P1 → P2"]);
		expect(Array.from(reader.querySelectorAll<HTMLAnchorElement>("p > a, li > a, pre a"), (link) => link.href)).toEqual([
			ISSUE, `${SITE}/show_bug.cgi?id=81`, "https://example.com/renderer/patch",
		]);
		expect(Array.from(reader.querySelectorAll("p"), (line) => line.textContent).filter((line) => !line.includes(" UTC"))).toEqual([
			"Bug 42 · Open", "Status: NEW", "Product: Sample", "Component: Painting", "Type: Defect", "Priority: P2",
			"Severity: S3", "Tracking: Tracking not set", "Details: Whiteboard: sample issue",
		]);
	});
});

describe("default extraction when the public discussion is unverified", () => {
	it("leaves the empty publisher response to the default parser", () => {
		const input = { html: "", url: ISSUE, documentUrl: ISSUE, thumbnailUrl: null };
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});

	it.each([
		["search", `${SITE}/buglist.cgi?id=42`, ISSUE],
		["login", `${SITE}/index.cgi?GoAheadAndLogIn=1`, ISSUE],
		["other saved issue", `${SITE}/show_bug.cgi?id=81`, ISSUE],
		["other resolved issue", ISSUE, `${SITE}/show_bug.cgi?id=81`],
		["external wrapper", ISSUE, "https://archive.example/snapshot"],
		["ambiguous issue query", `${ISSUE}&id=81`, ISSUE],
		["alternate format", `${ISSUE}&ctype=xml`, ISSUE],
	])("uses the default parser for %s", (_label, url, documentUrl) => {
		const input = { html: FIXTURE, url, documentUrl, thumbnailUrl: null };
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});

	it.each([
		["absent canonical", `<link rel="canonical" href="${ISSUE}">`, ""],
		["ambiguous canonical", `<link rel="canonical" href="${ISSUE}">`, `<link rel="canonical" href="${ISSUE}"><link rel="canonical" href="${ISSUE}">`],
		["ambiguous Open Graph", `<meta property="og:url" content="${ISSUE}">`, `<meta property="og:url" content="${ISSUE}"><meta property="og:url" content="${ISSUE}">`],
		["different canonical identity", ISSUE, `${SITE}/show_bug.cgi?id=81`],
		["different Open Graph identity", `property="og:url" content="${ISSUE}"`, `property="og:url" content="${SITE}/show_bug.cgi?id=81"`],
		["missing site template marker", 'name="generator"', 'name="unknown-generator"'],
		["missing signed-out marker", 'id="login_link_top"', 'id="different-link"'],
		["signed-in marker", "Log in</a>", 'Log in</a><a href="/index.cgi?logout=1">Log out</a>'],
		["hidden issue body", 'id="main-inner"', 'id="main-inner" style="visibility: hidden"'],
		["missing issue title", 'id="field-value-short_desc"', 'id="unknown-summary"'],
		["missing issue target", 'id="field-value-bug_id"', 'id="unknown-id"'],
		["inconsistent visible issue ID", "Bug 42</a>", "Bug 81</a>"],
		["inconsistent visible issue link", `href="${ISSUE_PATH}">Bug 42`, 'href="/show_bug.cgi?id=81">Bug 42'],
		["missing status badge", 'class="bug-status-label"', 'class="unknown-status-label"'],
		["missing status", 'id="field-value-status-view"', 'id="unknown-status"'],
		["missing header date", "Opened ", "Posted "],
		["missing header date marker", 'class="bug-time-label"', 'class="unknown-time-label"'],
		["unparseable date", 'title="2020-01-02 03:04 UTC"', 'title="Some time ago"'],
		["different absolute date", 'title="2020-01-02 03:04 UTC"', 'title="2020-01-02 03:08 UTC"'],
		["missing numeric date", 'data-time=', 'data-relative='],
		["missing opening event", 'id="c0"', 'id="c2"'],
		["duplicate event identity", 'id="c1"', 'id="c0"'],
		["unexpected event class", 'class="change-set" id="c1"', 'class="change-set collapsed" id="c1"'],
		["hidden event", 'class="change-set" id="c1"', 'class="change-set" id="c1" hidden'],
		["private comment", 'class="comment" data-no="1"', 'class="comment bz_private" data-no="1"'],
		["hidden authored body", 'class="comment-text" data-comment-id="101"', 'class="comment-text" data-comment-id="101" inert'],
		["mismatched comment body", 'data-comment-id="101"', 'data-comment-id="404"'],
		["missing comment number", 'data-no="1"', 'data-other="1"'],
		["missing comment ID", 'data-id="101"', 'data-other="101"'],
		["bad event name", "Comment 1</a>", "Comment 2</a>"],
		["bad event permalink", `${ISSUE_PATH}#c1`, `${ISSUE_PATH}#c2`],
		["bad profile link", "/user_profile?user_id=12", "/help"],
		["missing author label", 'class="fna">Example Maintainer', 'class="unrecognized-author">Example Maintainer'],
		["missing event date", 'class="change-time"', 'class="unknown-change-time"'],
		["missing change header", 'class="change" id="aa5_6"', 'class="unknown-change" id="aa5_6"'],
		["missing activity", 'class="activity"', 'class="unknown-activity"'],
		["unexpected history item", 'class="change">Priority:', 'class="unknown-change">Priority:'],
		["invalid activity entry", '<div class="change">Priority: P1 → P2</div>', ""],
		["missing discussion destination", 'href="https://example.com/renderer/patch"', 'href=""'],
		["malformed discussion destination", 'href="https://example.com/renderer/patch"', 'href="https://["'],
		["unsafe discussion destination", 'href="https://example.com/renderer/patch"', 'href="javascript:undefined"'],
		["unrecognized commentary markup", '<a href="https://example.com/renderer/patch">the patch</a>', "<details open><summary>the patch</summary></details><code>the patch</code>"],
	])("uses the default parser for %s", (_label, from, to) => {
		const html = FIXTURE.replace(from, to);
		const input = { html, url: ISSUE, documentUrl: ISSUE, thumbnailUrl: null };
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});

	it("uses the remaining visible metadata when an optional field is absent", () => {
		const html = FIXTURE.replace('id="field-value-priority"', 'id="unknown-priority"').replace(">S3</span>", "></span>");
		const { title, reader } = parse({ html });
		expect(title).toBe(TITLE);
		expect(reader.querySelectorAll("pre")).toHaveLength(2);
		expect(Array.from(reader.querySelectorAll("p"), (line) => line.textContent).filter((line) => /^Priority:|^Severity:/.test(line))).toEqual([]);
	});
});
