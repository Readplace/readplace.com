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
const PEOPLE_HEADING = '<h3 id="module-people-subtitle">(Reporter: Example Reporter, Unassigned)</h3>';

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
		<section id="module-people"><header><div>${PEOPLE_HEADING}</div></header>
			<div id="module-people-content" style="display: none">Assignment editor</div></section>
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
		<div id="bottom-actions"></div>
	</div></main></body></html>`;

const offline = () => { throw new Error("The parser must use the supplied HTML."); };
const { siteRules } = initArticleSiteRules({ crawlFetch: offline, logError: offline });
const parser = initReadabilityParser({ coverageRules: { inspect: () => [] }, siteRules, readabilityAdditions, crawlArticle: offline, logError: offline });
const stock = initReadabilityParser({ coverageRules: { inspect: () => [] }, siteRules: [], readabilityAdditions, crawlArticle: offline, logError: offline });

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
			"Severity: S3", "Tracking: Tracking not set", "Details: Whiteboard: sample issue", "Assignee: Unassigned",
		]);
	});

	it.each([
		["missing", PEOPLE_HEADING, ""],
		["hidden", PEOPLE_HEADING, PEOPLE_HEADING.replace("<h3 ", "<h3 hidden ")],
		["marked up", "Unassigned)</h3>", "<a href=\"/help\">Unassigned</a>)</h3>"],
		["ambiguous", PEOPLE_HEADING, `${PEOPLE_HEADING}${PEOPLE_HEADING.replace("Unassigned", "Example Maintainer")}`],
		["different reporter", "Reporter: Example Reporter", "Reporter: Example Maintainer"],
		["different author role", ">Reporter</span>", ">Maintainer</span>"],
		["unrecognized assignment", "Example Reporter, Unassigned", "Example Reporter, Example Maintainer"],
	])("omits an %s public assignment without dropping the discussion", (_case, from, to) => {
		const { reader } = parse({ html: FIXTURE.replace(from, to) });
		expect(reader.textContent).not.toContain("Assignee:");
		expect(reader.querySelectorAll("pre")).toHaveLength(2);
	});

	it("omits an empty tracking placeholder", () => {
		const { reader } = parse({ html: FIXTURE.replace("Tracking not set", "(  )") });
		expect(reader.textContent).not.toContain("Tracking:");
		expect(reader.textContent).toContain("Assignee: Unassigned");
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

const END = '<div id="bottom-actions"></div>';
const PATCH_PATH = "/attachment.cgi?id=13";
const PATCH_LINK = `${PATCH_PATH}&amp;action=diff`;
const EDIT_LINK = `${PATCH_PATH}&amp;action=edit`;
const PATCH_CARD = `<div id="att-13" data-id="13" class="attachment patch"><div class="label">
	Created attachment <a class="link" href="${PATCH_LINK}"><span>Renderer patch</span></a>
	[<a href="${EDIT_LINK}" data-details>Details</a>] [<a href="/page.cgi?id=review&amp;attachment=13">Review</a>]</div></div>`;
const RICH_CODE = "function below(a, b) {\n  return a < b && b > 0;\n}\n";
const RICH = `<p>A small <strong>worked example</strong> follows.<br><br>Read the <a href="https://example.com/samples"><code>sample</code></a>.</p>
	<!-- editor metadata absent from prose -->
	<pre><code>function below(a, b) {\n  return a &lt; b &amp;&amp; b &gt; 0;\n}\n</code></pre>
	<ul><li>Reproduce in the browser.<ol><li>Open the demo.<br>Wait for a frame.</li></ol></li><li>Inspect the result.</li></ul>`;
const RICH_EVENT = `<div class="change-set" id="c2">
	<div class="comment" data-no="2" data-id="102">${eventHead("c2", "Comment 2", UPDATED, "Example Maintainer", 12)}</div>
	${PATCH_CARD}
	<div class="comment-text markdown-body" data-comment-id="102">${RICH}</div>
</div>`;
const HISTORY = `<div class="change-set" id="a7_8">
	<div class="change" id="aa7_8">${eventHead("a7_8", "Updated", UPDATED, "Example Reporter", 11)}</div>
	<div class="activity"><div class="change"><a href="${EDIT_LINK}">Attachment 13</a>: review requested</div></div>
</div>`;
const RICH_FIXTURE = FIXTURE.replace(END, `${RICH_EVENT}${HISTORY}${END}`);

describe("rich comments and public patch affordances", () => {
	it("retains plain-text publisher tooltips for issue links and leaves attachment-edit controls inert", () => {
		const html = RICH_FIXTURE
			.replace('href="/show_bug.cgi?id=81"', 'class="bz_bug_link bz_status_NEW" title="NEW – Sample &amp; example" href="/show_bug.cgi?id=81"')
			.replace('href="https://example.com/renderer/patch"', `class="bz_bug_link" title="NEW – Source &quot;label&quot; &lt;img&gt;" href="${ISSUE_PATH}#c0"`)
			.replace('href="https://example.com/samples"', 'class="bz_bug_link" title="RESOLVED – Another example" href="/show_bug.cgi?id=83"')
			.replace(`href="${EDIT_LINK}">Attachment 13`, `title="Edit attachment" href="${EDIT_LINK}">Attachment 13`);
		const { reader } = parse({ html });
		expect(Array.from(reader.querySelectorAll("a[title]"), (anchor) => [anchor.getAttribute("href"), anchor.getAttribute("title")])).toEqual([
			[`${SITE}/show_bug.cgi?id=81`, "NEW – Sample & example"],
			[`${ISSUE}#c0`, 'NEW – Source "label" <img>'],
			[`${SITE}/show_bug.cgi?id=83`, "RESOLVED – Another example"],
		]);
		expect(reader.querySelector('a[href*="action=edit"], img')).toBeNull();
	});

	it.each([
		['class="bz_bug_link" title=" " href="/show_bug.cgi?id=81"'],
		['title="Ordinary external title" href="https://example.com/samples"'],
		['class="bz_bug_link" title="Unverified issue title" href="https://example.com/samples"'],
	])("omits a blank or unverified tooltip on %s", (attributes) => {
		const { reader } = parse({ html: RICH_FIXTURE.replace('href="https://example.com/samples"', attributes) });
		expect(reader.querySelector("div:has(> pre > code) a[title]")).toBeNull();
		expect(reader.querySelector("div:has(> pre > code) a")?.textContent).toBe("sample");
	});

	it("preserves earlier flat comments and renders the Markdown shape, code and read-only patch affordance in order", () => {
		const { title, reader } = parse({ html: RICH_FIXTURE });
		expect(title).toBe(TITLE);
		expect(Array.from(reader.querySelectorAll("pre"), (element) => element.textContent)).toEqual([DESCRIPTION, COMMENT, RICH_CODE]);
		expect(Array.from(reader.querySelectorAll("h3"), (element) => element.textContent)).toEqual([
			"Description · Example Reporter (Reporter)", "Updated · Example Maintainer",
			"Comment 1 · Example Reporter", "Comment 2 · Example Maintainer", "Updated · Example Reporter",
		]);
		const rich = reader.querySelector("div:has(> pre > code)");
		assert(rich);
		expect(Array.from(rich.children, (element) => element.localName)).toEqual(["p", "pre", "ul"]);
		expect(rich.querySelector("p > strong")?.textContent).toBe("worked example");
		expect(rich.querySelector<HTMLAnchorElement>("p > a:has(> code)")?.href).toBe("https://example.com/samples");
		expect(rich.querySelector("pre > code")?.textContent).toBe(RICH_CODE);
		expect(rich.querySelectorAll("br")).toHaveLength(3);
		expect(rich.querySelector("ul > li > ol > li")?.textContent).toBe("Open the demo.Wait for a frame.");
		const attachment = Array.from(reader.querySelectorAll<HTMLAnchorElement>('a[href*="/attachment.cgi"]'));
		expect(attachment.map((link) => [link.textContent, link.href])).toEqual([["Renderer patch", `${SITE}${PATCH_PATH}&action=diff`]]);
		expect(attachment[0].parentElement?.previousElementSibling?.textContent).toBe(UPDATED);
		expect(attachment[0].parentElement?.nextElementSibling).toBe(rich);
		expect(Array.from(reader.querySelectorAll("li"), (element) => element.textContent).at(-1)).toBe("Attachment 13: review requested");
	});

	it("keeps hidden text, editor elements, attachment assets and hidden reference modules outside the visible discussion", () => {
		const html = RICH_FIXTURE
			.replace(RICH, `<form><input><textarea>Editor</textarea></form><template>Template</template>${RICH.replace("A small", '<span hidden>Never publish this</span><span style="visibility:hidden">Hidden inline</span>A small')}`)
			.replace("Created attachment", '<img src="https://example.com/attachment.png">Created attachment');
		const baseline = parse({ html: RICH_FIXTURE });
		const changed = parse({ html });
		expect(changed.content).toBe(baseline.content);
	});

	it.each([
		["different card kind", PATCH_CARD.replace("attachment patch", "attachment other")],
		["hidden card", PATCH_CARD.replace("id=\"att-13\"", "id=\"att-13\" hidden")],
		["private card", PATCH_CARD.replace("attachment patch", "attachment patch bz_private")],
		["missing card ID", PATCH_CARD.replace('data-id="13"', "")],
		["non-numeric card ID", PATCH_CARD.replace('data-id="13"', 'data-id="sample"')],
		["mismatched card ID", PATCH_CARD.replace('id="att-13"', 'id="att-99"')],
		["duplicate cards", `${PATCH_CARD}${PATCH_CARD}`],
		["missing safe label anchor", PATCH_CARD.replace('a class="link"', 'a class="other"')],
		["empty label text", PATCH_CARD.replace("Renderer patch", "")],
		["missing href value", PATCH_CARD.replace(PATCH_LINK, "")],
		["malformed target", PATCH_CARD.replace(PATCH_LINK, "https://[")],
		["different origin", PATCH_CARD.replace(PATCH_LINK, `https://example.com${PATCH_LINK}`)],
		["different path", PATCH_CARD.replace(PATCH_LINK, "/view.cgi?id=13&amp;action=diff")],
		["different target ID", PATCH_CARD.replace(PATCH_LINK, "/attachment.cgi?id=99&amp;action=diff")],
		["ambiguous target ID", PATCH_CARD.replace(PATCH_LINK, "/attachment.cgi?id=13&amp;id=99&amp;action=diff")],
		["editor target", PATCH_CARD.replace(PATCH_LINK, EDIT_LINK)],
		["ambiguous action", PATCH_CARD.replace(PATCH_LINK, `${PATCH_LINK}&amp;action=edit`)],
		["unexpected query", PATCH_CARD.replace(PATCH_LINK, `${PATCH_LINK}&amp;extra=true`)],
	])("keeps the rich discussion with %s and no copied attachment target", (_type, card) => {
		const { title, reader } = parse({ html: RICH_FIXTURE.replace(PATCH_CARD, card) });
		expect(title).toBe(TITLE);
		expect(reader.querySelector("pre > code")?.textContent).toBe(RICH_CODE);
		expect(Array.from(reader.querySelectorAll<HTMLAnchorElement>('a[href*="/attachment.cgi"]'), (node) => node.href)).toEqual([]);
	});
});

describe("unsupported rich or incomplete templates", () => {
	it.each([
		["missing final issue chrome", RICH_FIXTURE.replace(END, "")],
		["final issue chrome before events", RICH_FIXTURE.replace(END, "").replace('<div class="change-set" id="c0">', `${END}<div class="change-set" id="c0">`)],
		["no timeline", `${FIXTURE.slice(0, FIXTURE.indexOf('<div class="change-set" id="c0">'))}${END}</div></main></body></html>`],
		["missing interior comment", FIXTURE.replace('id="c1"', 'id="c2"')],
		["unsupported comment marker", RICH_FIXTURE.replace("comment-text markdown-body", "comment-text unrecognized")],
		["top level prose outside Markdown blocks", RICH_FIXTURE.replace(RICH, `Loose source text${RICH}`)],
		["non-list text inside a list", RICH_FIXTURE.replace("<ul><li>Reproduce", "<ul>Loose list text<li>Reproduce")],
		["unsupported rich element", RICH_FIXTURE.replace("<strong>worked example</strong>", "<img src=\"https://example.com/remote\">")],
		["known rich tag with invalid nesting", RICH_FIXTURE.replace("<ul><li>Reproduce", "<ul><strong>Invalid</strong><li>Reproduce")],
		["empty rich link", RICH_FIXTURE.replace("https://example.com/samples", "")],
		["unsafe rich link", RICH_FIXTURE.replace("https://example.com/samples", "javascript:undefined")],
		["unverified attachment link inside a rich comment", RICH_FIXTURE.replace("https://example.com/samples", PATCH_LINK)],
		["unverified attachment link inside a flat comment", RICH_FIXTURE.replace("https://example.com/renderer/patch", PATCH_LINK)],
		["unsupported attachment action in history", RICH_FIXTURE.replace(`href="${EDIT_LINK}">Attachment 13`, `href="${PATCH_LINK}">Attachment 13`)],
		["two visible issue links", RICH_FIXTURE.replace("Bug 42</a>", `Bug 42</a><a href="${ISSUE_PATH}">Bug 42</a>`)],
		["two comment headers", RICH_FIXTURE.replace(RICH_EVENT, RICH_EVENT.replace(PATCH_CARD, `<div class="comment">${eventHead("c2", "Comment 2", UPDATED, "Duplicate", 12)}</div>${PATCH_CARD}`))],
		["two visible comment bodies", RICH_FIXTURE.replace(RICH_EVENT, RICH_EVENT.replace(PATCH_CARD, `<div class="comment-text">Duplicate</div>${PATCH_CARD}`))],
		["two activity lists", RICH_FIXTURE.replace(HISTORY, HISTORY.replace('<div class="activity">', '<div class="activity"><div class="change">Duplicate</div></div><div class="activity">'))],
	])("uses the default parser for %s", (_type, html) => {
		const input = { html, url: ISSUE, documentUrl: ISSUE, thumbnailUrl: null };
		expect(parser.parseHtml(input)).toEqual(stock.parseHtml(input));
	});
});
