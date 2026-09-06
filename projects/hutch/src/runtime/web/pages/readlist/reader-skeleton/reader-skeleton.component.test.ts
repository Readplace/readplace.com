import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { generateCspNonce } from "@packages/web-shell";
import { StickyReader } from "../../../shared/article-body/reader-actions/reader-actions.component";
import {
	READER_PAGE_SCRIPTS,
	renderReaderSkeleton,
	VIEW_BACK_LINK,
} from "./reader-skeleton.component";

const UNSTYLED_HOOK_CLASSES = new Set([
	"reader__article-body",
	"article-body__back-slot",
	"article-body__readlists-slot",
	"article-body__mark-read-slot",
	"article-body__download-epub-slot",
	"article-body__read-time",
	"article-body__reader-slot",
	"reader-skeleton",
]);
const SHELL_BUTTON_CLASSES = new Set(["btn", "btn--secondary", "btn--compact"]);

function templateContent(): DocumentFragment {
	const html = renderReaderSkeleton({ cspNonce: generateCspNonce() });
	const template = new JSDOM(html).window.document.querySelector("template");
	assert(template, "the skeleton must render a single <template>");
	return template.content;
}

describe("renderReaderSkeleton", () => {
	it("marks the template with the classes the client applies at paint", () => {
		const html = renderReaderSkeleton({ cspNonce: generateCspNonce() });
		const template = new JSDOM(html).window.document.querySelector("template");
		assert(template, "the skeleton must render a single <template>");
		expect(template.hasAttribute("data-reader-skeleton")).toBe(true);
		expect(template.getAttribute("data-main-class")).toBe("reader");
		expect(template.getAttribute("data-body-class")).toBe(
			StickyReader({ actionBtns: { readlistPicker: undefined } }).bodyClass,
		);
		expect(template.getAttribute("data-body-class-from")).toBe("page-readlist");
	});

	it("shows the back, readlists and mark-read toolbar slots and hides the epub slot", () => {
		const content = templateContent();
		const slots = [
			".article-body__back-slot",
			".article-body__readlists-slot",
			".article-body__mark-read-slot",
			".article-body__download-epub-slot",
		].map((selector) => {
			const slot = content.querySelector(selector);
			assert(slot, `${selector} must be present`);
			return slot.classList.contains(`${selector.slice(1)}--visible`);
		});
		expect(slots).toEqual([true, true, true, false]);
	});

	it("makes the two dummy controls inert so the skeleton cannot be interacted with", () => {
		const content = templateContent();
		expect(content.querySelector(".article-body__readlists-slot")?.hasAttribute("inert")).toBe(true);
		expect(content.querySelector(".article-body__mark-read-slot")?.hasAttribute("inert")).toBe(true);
	});

	it("gives the back link the reader's own back destination", () => {
		const back = templateContent().querySelector(".article-body__back");
		assert(back, "the skeleton toolbar must carry a back link");
		expect(back.getAttribute("href")).toBe(VIEW_BACK_LINK.topHref);
		expect(back.textContent).toContain(VIEW_BACK_LINK.label);
	});

	it("names the header fields the client fills from the card", () => {
		const content = templateContent();
		const textTargets = Array.from(content.querySelectorAll("[data-reader-field-text]")).map((el) =>
			el.getAttribute("data-reader-field-text"),
		);
		expect(textTargets).toEqual(["title", "site", "read-time"]);
		const hrefTargets = Array.from(content.querySelectorAll("[data-reader-field-href]")).map((el) =>
			el.getAttribute("data-reader-field-href"),
		);
		expect(hrefTargets).toEqual(["site"]);
		expect(
			content
				.querySelector('[data-reader-field-text="read-time"]')
				?.getAttribute("data-reader-field-empty-class"),
		).toBe("article-body__read-time--empty");
	});

	it("renders the loading reader slot with static placeholder lines and no live progress bar", () => {
		const content = templateContent();
		const slot = content.querySelector("[data-test-reader-skeleton]");
		assert(slot, "the skeleton must render its loading reader slot");
		expect(slot.getAttribute("data-reader-status")).toBe("loading");
		expect(content.querySelectorAll(".reader-skeleton__line").length).toBe(9);
		expect(content.querySelectorAll("[data-progress-bar]").length).toBe(0);
	});

	it("carries no ids, so htmx never id-matches the skeleton against the reader it replaces", () => {
		expect(templateContent().querySelectorAll("[id]").length).toBe(0);
	});

	it("ships the reader's frame and placeholder CSS in a nonce'd style tag", () => {
		const nonce = generateCspNonce();
		const template = new JSDOM(renderReaderSkeleton({ cspNonce: nonce })).window.document.querySelector(
			"template",
		);
		assert(template, "the skeleton must render a single <template>");
		const style = template.content.querySelector("style");
		assert(style, "the skeleton must ship its own style tag inside the template");
		expect(style.getAttribute("nonce")).toBe(nonce);
		expect(style.textContent).toContain(".article-body__title");
		expect(style.textContent).toContain(".reader-skeleton__line");
	});

	it("styles every class the template paints from its own stylesheet, so the queue never needs the reader's CSS", () => {
		const content = templateContent();
		const style = content.querySelector("style");
		assert(style, "the skeleton must ship its own style tag inside the template");
		const css = style.textContent ?? "";
		const painted = new Set<string>();
		for (const element of content.querySelectorAll("[class]")) {
			for (const name of element.classList) painted.add(name);
		}
		const styled = Array.from(painted).filter(
			(name) => !UNSTYLED_HOOK_CLASSES.has(name) && !SHELL_BUTTON_CLASSES.has(name),
		);
		expect(styled.length).toBeGreaterThan(10);
		const unstyled = styled.filter((name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css));
		expect(unstyled).toEqual([]);
	});

	it("lists every reader client bundle the filled reader needs, in load order", () => {
		const srcs = Array.from(READER_PAGE_SCRIPTS.matchAll(/src="([^"]+)"/g)).map((match) => match[1]);
		expect(srcs).toEqual([
			"/client-dist/share-balloon.client.js",
			"/client-dist/next-read.client.js",
			"/client-dist/progress-bar.client.js",
			"/client-dist/summary-toggle.client.js",
			"/client-dist/crawl-bookmark.client.js",
			"/client-dist/readlist-picker.client.js",
			"/client-dist/reader-exit-confirm.client.js",
			"/client-dist/reader-open.client.js",
		]);
	});
});
