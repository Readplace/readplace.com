import assert from "node:assert/strict";
import type { ReaderFailedVariant } from "@packages/article-state-types";
import type { ArticleCrawl } from "@packages/provider-contracts/article-crawl";
import { JSDOM } from "jsdom";
import { renderReaderReady } from "../reader-slot/reader-ready.component";
import {
	TABLE_OF_CONTENTS_SCRIPT,
	isTableOfContentsVisible,
	renderTableOfContents,
} from "./table-of-contents.component";
import { articleBody } from "@packages/test-fixtures";
import type { ArticleBody } from "@packages/domain/article";

const APP_ORIGIN = "https://readplace.com";
const HEADED_CONTENT = articleBody(
	"<h2>Why it matters</h2><p>One</p><h3>How to start</h3><p>Two</p><h4>Footnotes</h4><h2>Why it matters</h2><p>Three</p>",
);

interface ReaderViewCase {
	reader: string;
	crawl: ArticleCrawl | undefined;
	content: ArticleBody | undefined;
	notice: ReaderFailedVariant | undefined;
}

const STATE_CASES: (ReaderViewCase & { state: string })[] = [
	{ reader: "ready, with h2 and h3 sections", crawl: { status: "ready" }, content: HEADED_CONTENT, notice: undefined, state: "listed" },
	{ reader: "ready, with no h2 or h3", crawl: { status: "ready" }, content: articleBody("<p>One</p><h4>Minor</h4>"), notice: undefined, state: "empty" },
	{ reader: "a legacy row with no crawl record", crawl: undefined, content: HEADED_CONTENT, notice: undefined, state: "listed" },
	{ reader: "pending", crawl: { status: "pending" }, content: undefined, notice: undefined, state: "hidden" },
	{ reader: "ready before its content landed", crawl: { status: "ready" }, content: undefined, notice: undefined, state: "hidden" },
	{ reader: "pending again over published content", crawl: { status: "pending" }, content: HEADED_CONTENT, notice: undefined, state: "hidden" },
	{
		reader: "failed",
		crawl: { status: "failed", reason: JSON.stringify({ kind: "exhausted-retries", receiveCount: 3 }) },
		content: undefined,
		notice: undefined,
		state: "hidden",
	},
	{
		reader: "blocked",
		crawl: { status: "failed", reason: JSON.stringify({ kind: "blocked", cause: "edge-block" }) },
		content: undefined,
		notice: undefined,
		state: "hidden",
	},
	{
		reader: "unsupported",
		crawl: { status: "unsupported", reason: "non-html content type: application/pdf" },
		content: undefined,
		notice: undefined,
		state: "hidden",
	},
	{ reader: "not an article", crawl: { status: "ready" }, content: HEADED_CONTENT, notice: "not-an-article", state: "hidden" },
];

const VISIBILITY_CASES: (ReaderViewCase & { visible: boolean })[] = [
	{ reader: "ready", crawl: { status: "ready" }, content: articleBody("<p>One</p>"), notice: undefined, visible: true },
	{ reader: "a legacy row", crawl: undefined, content: articleBody("<p>One</p>"), notice: undefined, visible: true },
	{ reader: "pending with published content", crawl: { status: "pending" }, content: articleBody("<p>One</p>"), notice: undefined, visible: false },
	{ reader: "under a notice", crawl: { status: "ready" }, content: articleBody("<p>One</p>"), notice: "not-an-article", visible: false },
];

function parse(html: string): Document {
	return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function wrapperOf(html: string): Element {
	const wrapper = parse(html).querySelector("#table-of-contents");
	assert(wrapper, "the table of contents wrapper must always be rendered");
	return wrapper;
}

function render(input: {
	crawl: ArticleCrawl | undefined;
	content: ArticleBody | undefined;
	notice?: ReaderFailedVariant;
	oob?: boolean;
}): string {
	return renderTableOfContents({
		crawl: input.crawl,
		content: input.content,
		notice: input.notice,
		appOrigin: APP_ORIGIN,
		oob: input.oob === true,
	});
}

describe("renderTableOfContents", () => {
	it.each(STATE_CASES)("renders the $state state when the reader view is $reader", ({ crawl, content, notice, state }) => {
		const wrapper = wrapperOf(render({ crawl, content, notice }));

		expect([wrapper.getAttribute("data-test-table-of-contents"), wrapper.classList.contains(`table-of-contents--${state}`)]).toEqual([
			state,
			true,
		]);
	});

	it("renders no card inside a hidden wrapper", () => {
		const wrapper = wrapperOf(render({ crawl: { status: "pending" }, content: undefined }));

		expect(wrapper.children).toHaveLength(0);
	});

	it("lists the sections in document order, each row linking to its own anchor", () => {
		const wrapper = wrapperOf(render({ crawl: { status: "ready" }, content: HEADED_CONTENT }));

		const rows = Array.from(wrapper.querySelectorAll("[data-test-toc-section]"), (row) => ({
			href: row.getAttribute("href"),
			anchor: row.getAttribute("data-test-toc-section"),
			text: row.textContent,
		}));
		expect(rows).toEqual([
			{ href: "#section-why-it-matters", anchor: "section-why-it-matters", text: "Why it matters" },
			{ href: "#section-how-to-start", anchor: "section-how-to-start", text: "How to start" },
			{ href: "#section-why-it-matters-2", anchor: "section-why-it-matters-2", text: "Why it matters" },
		]);
	});

	it("builds the listed card on the disclosure card, with the list as the card's body", () => {
		const wrapper = wrapperOf(render({ crawl: { status: "ready" }, content: HEADED_CONTENT }));

		const card = wrapper.querySelector(":scope > details[data-test-toc-card]");
		assert(card, "the card must be the wrapper's own child");
		const body = card.querySelector(":scope > nav.disclosure-card__body");
		assert(body, "the list must be the card's body");
		expect([
			card.hasAttribute("open"),
			card.querySelector(":scope > summary.disclosure-card__header")?.textContent?.trim(),
			body.getAttribute("aria-label"),
			body.querySelector(":scope > ol")?.getAttribute("role"),
		]).toEqual([true, "Table of contents", "Table of contents", "list"]);
	});

	it("tells the reader there are no sections when a ready article has no h2 or h3", () => {
		const wrapper = wrapperOf(render({ crawl: { status: "ready" }, content: articleBody("<p>One paragraph.</p>") }));

		const empty = wrapper.querySelector("details[data-test-toc-card] > .disclosure-card__body[data-test-toc-empty]");
		assert(empty, "the empty state must be the card's body");
		expect(Array.from(empty.querySelectorAll("p"), (line) => line.textContent)).toEqual([
			"No sections found",
			"This article doesn't have any sections to show.",
		]);
	});

	it("marks the wrapper for an out-of-band swap only when asked", () => {
		const content = articleBody("<p>One paragraph.</p>");

		expect([
			wrapperOf(render({ crawl: { status: "ready" }, content, oob: true })).getAttribute("hx-swap-oob"),
			wrapperOf(render({ crawl: { status: "ready" }, content, oob: false })).hasAttribute("hx-swap-oob"),
		]).toEqual(["outerHTML", false]);
	});

	it("links every row to a heading the reader slot renders from the same content", () => {
		const doc = parse(
			`${render({ crawl: { status: "ready" }, content: HEADED_CONTENT })}${renderReaderReady({ content: HEADED_CONTENT, appOrigin: APP_ORIGIN })}`,
		);

		const slot = doc.querySelector("[data-test-reader-content]");
		assert(slot, "the reader slot must render its content");
		const slotIds = new Set(Array.from(slot.querySelectorAll("[id]"), (element) => element.id));
		const resolved = Array.from(doc.querySelectorAll("[data-test-toc-section]"), (row) =>
			slotIds.has(String(row.getAttribute("href")).slice(1)),
		);
		expect(resolved).toEqual([true, true, true]);
	});

	it("lists only the headings the reader body keeps, under the text the body shows", () => {
		const content = articleBody(
			"<h2>Intro<script>track()</script></h2><noscript><h2>Enable JavaScript</h2></noscript><h3>Method</h3>",
		);

		const wrapper = wrapperOf(render({ crawl: { status: "ready" }, content }));

		const rows = Array.from(wrapper.querySelectorAll("[data-test-toc-section]"), (row) => ({
			href: row.getAttribute("href"),
			text: row.textContent,
		}));
		expect(rows).toEqual([
			{ href: "#section-intro", text: "Intro" },
			{ href: "#section-method", text: "Method" },
		]);
	});

	it("loads its client bundle from the same origin, deferred", () => {
		const script = parse(TABLE_OF_CONTENTS_SCRIPT).querySelector("script");
		assert(script, "the script tag must parse");
		expect([script.getAttribute("src"), script.hasAttribute("defer")]).toEqual(["/client-dist/table-of-contents.client.js", true]);
	});
});

describe("isTableOfContentsVisible", () => {
	it.each(VISIBILITY_CASES)("is $visible when the reader view is $reader", ({ crawl, content, notice, visible }) => {
		expect(isTableOfContentsVisible({ crawl, content, notice })).toBe(visible);
	});
});
