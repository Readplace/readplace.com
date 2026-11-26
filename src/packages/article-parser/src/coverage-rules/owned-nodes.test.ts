import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
	countWords,
	isLinkedItemGroup,
	isOwnedInDocument,
	isThreadOrTeaserBlock,
	isUnowned,
	offPageLink,
	ownedNodeWords,
	ownedWords,
	textOf,
} from "./owned-nodes";

const PAGE = "https://example.com/guide";

function body(html: string): HTMLElement {
	return parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`).document.body;
}

function first(html: string): Element {
	const el = body(html).firstElementChild;
	assert(el !== null);
	return el;
}

describe("isUnowned", () => {
	it.each([
		["a script", "<script>x</script>"],
		["a nav", "<nav>menu</nav>"],
		["an aside", "<aside>more</aside>"],
		["a hidden element", "<div hidden>x</div>"],
		["an aria-hidden element", '<div aria-hidden="true">x</div>'],
		["display:none", '<div style="color: red; display: none">x</div>'],
		["visibility:hidden", '<div style="visibility:hidden !important;">x</div>'],
		["a navigation role", '<div role="navigation">x</div>'],
		["a page header", "<header>site</header>"],
		["a page footer", "<footer>site</footer>"],
	])("treats %s as unowned", (_name, html) => {
		expect(isUnowned(first(html))).toBe(true);
	});

	it.each([
		["a plain div", "<div>x</div>"],
		["a div whose style merely mentions display", '<div style="display: block">x</div>'],
		["aria-hidden false", '<div aria-hidden="false">x</div>'],
		["a main role", '<div role="main">x</div>'],
		["a class named invisible", '<table class="invisible"><tr><td>x</td></tr></table>'],
	])("treats %s as owned", (_name, html) => {
		expect(isUnowned(first(html))).toBe(false);
	});

	it("owns a header inside an article", () => {
		const header = body("<article><header>Title</header></article>").querySelector("header");
		expect(header && isUnowned(header)).toBe(false);
	});

	it("disowns a detached header", () => {
		expect(isUnowned(body("").ownerDocument.createElement("header"))).toBe(true);
	});
});

describe("isOwnedInDocument", () => {
	it("is false when an ancestor is unowned", () => {
		const root = body('<nav><div id="inner">x</div></nav><div id="outer">y</div>');
		const inner = root.querySelector("#inner");
		const outer = root.querySelector("#outer");
		expect(inner && isOwnedInDocument(inner)).toBe(false);
		expect(outer && isOwnedInDocument(outer)).toBe(true);
	});
});

describe("ownedWords", () => {
	it("counts owned words only and answers the same count again", () => {
		const root = first("<div>one two <span>three</span><nav>four</nav><!-- five --></div>");
		expect(ownedWords(root)).toBe(3);
		expect(ownedWords(root)).toBe(3);
	});

	it("counts nothing under an unowned element", () => {
		expect(ownedWords(first("<aside>one two</aside>"))).toBe(0);
	});

	it("counts text nodes and ignores comments", () => {
		const root = first("<div>one two<!-- c --></div>");
		const [text, comment] = [...root.childNodes];
		expect(ownedNodeWords(text)).toBe(2);
		expect(ownedNodeWords(comment)).toBe(0);
	});
});

describe("countWords and textOf", () => {
	it("splits on whitespace", () => {
		expect(countWords("  a  b\nc ")).toBe(3);
		expect(textOf(first("<p>a <b>b</b></p>"))).toBe("a b");
	});

	it("counts each Han, kana, Hangul or Thai character as a word", () => {
		expect(countWords("npm 手順を確認 ok")).toBe(7);
	});
});

describe("offPageLink", () => {
	it.each([
		["a fragment of this page", "#part-2", false],
		["this page with a fragment", "https://example.com/guide#x", false],
		["another page", "/other", true],
		["an unparseable href", "http://[", false],
	])("reads %s", (_name, href, expected) => {
		const anchor = first(`<a href="${href}">x</a>`);
		expect(offPageLink({ anchor, documentUrl: PAGE })).toBe(expected);
	});

	it("is false for an anchor without href", () => {
		expect(offPageLink({ anchor: first('<a name="x">x</a>'), documentUrl: PAGE })).toBe(false);
	});
});

describe("isLinkedItemGroup", () => {
	it("is true for three same-tag items each holding an off-page link", () => {
		const list = first('<ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li></ul>');
		expect(isLinkedItemGroup({ el: list, documentUrl: PAGE })).toBe(true);
	});

	it("accepts a heading or a time as the item marker", () => {
		const list = first("<div><div><time>1</time></div><div><h4>x</h4></div><div><time>2</time></div></div>");
		expect(isLinkedItemGroup({ el: list, documentUrl: PAGE })).toBe(true);
	});

	it("is false when the items differ in tag or link only within the page", () => {
		const mixed = first('<div><p><a href="/a">A</a></p><div><a href="/b">B</a></div><p><a href="#c">C</a></p></div>');
		expect(isLinkedItemGroup({ el: mixed, documentUrl: PAGE })).toBe(false);
	});
});

const teaser = (n: number) => `<li><h3>Story ${n}</h3><p>A short teaser about story number ${n}.</p></li>`;

describe("isThreadOrTeaserBlock", () => {
	it("is true for teaser items that are the block's own children", () => {
		expect(isThreadOrTeaserBlock(first(`<div>${[1, 2, 3].map((n) => teaser(n).replace(/li>/g, "section>")).join("")}</div>`))).toBe(true);
	});

	it("is true for teaser items inside a direct list child", () => {
		expect(isThreadOrTeaserBlock(first(`<div><ul>${[1, 2, 3, 4].map(teaser).join("")}</ul></div>`))).toBe(true);
	});

	it("is true for timed rows inside a direct table body", () => {
		const row = (n: number) => `<tr><td><time>day ${n}</time> a comment of several words</td></tr>`;
		expect(isThreadOrTeaserBlock(first(`<div><table><tbody>${[1, 2, 3].map(row).join("")}</tbody></table></div>`))).toBe(true);
	});

	it("is false when the items hold less than half of the block", () => {
		const prose = "word ".repeat(200);
		expect(isThreadOrTeaserBlock(first(`<div><p>${prose}</p><ul>${[1, 2, 3].map(teaser).join("")}</ul></div>`))).toBe(false);
	});

	it("is false when the items are longer than a teaser", () => {
		const long = (n: number) => `<li><h3>Part ${n}</h3><p>${"word ".repeat(90)}</p></li>`;
		expect(isThreadOrTeaserBlock(first(`<div><ul>${[1, 2, 3].map(long).join("")}</ul></div>`))).toBe(false);
	});

	it("is false for too few items", () => {
		expect(isThreadOrTeaserBlock(first(`<div><ul>${[1, 2].map(teaser).join("")}</ul></div>`))).toBe(false);
	});
});
