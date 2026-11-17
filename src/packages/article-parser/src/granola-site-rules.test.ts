import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { granolaSiteRules } from "./granola-site-rules";
import { initReadabilityParser } from "./readability-parser";
import { readabilityAdditions } from "./readability-additions";

const SHARED_NOTE_URL = "https://notes.granola.ai/d/00000000-sample-shared-note";
const SHARE_DIALOG =
	'<div role="dialog" data-slot="dialog-content"><h2 data-slot="dialog-title">Sample Person shared these notes with you</h2>' +
	"<p>Granola automatically turns your meetings into notes you can share with the people you work with.</p>" +
	'<a href="https://www.granola.ai/">Try Granola</a></div>';
const NOTE_PARAGRAPH =
	"The planning meeting agreed that the sample migration ships in two stages, with the reporting work moving to the next quarter so the team can finish the import changes first.";

function noteSection(heading: string, firstItem: number): string {
	const items = Array.from(
		{ length: 4 },
		(_, offset) => firstItem + offset,
	).map(
		(index) =>
			`<li><div class="react-renderer node-paragraph"><div><div class="relative flex items-start">${NOTE_PARAGRAPH} Item ${index}.</div></div></div></li>`,
	);
	return `<h1 class="view-source-heading">${heading}</h1><ul class="tight">${items.join("")}</ul>`;
}

function sharedNotePage(): string {
	return (
		"<!DOCTYPE html><html><head><title>Sample planning meeting</title></head><body>" +
		'<div class="layout_abc12"><header class="header_def34"><a href="/">Granola</a></header>' +
		'<main aria-hidden="true" class="main_ghi56"><h1>Sample planning meeting</h1>' +
		'<div class="editor_jkl78"><div contenteditable="false" translate="no" class="tiptap ProseMirror editor_mno90">' +
		noteSection("Decisions", 0) +
		noteSection("Open questions", 4) +
		noteSection("Next steps", 8) +
		"</div></div></main></div>" +
		SHARE_DIALOG +
		"</body></html>"
	);
}

describe("granolaSiteRules.matches", () => {
	it("matches notes.granola.ai", () => {
		assert.equal(granolaSiteRules.matches({ url: SHARED_NOTE_URL, hostname: "notes.granola.ai" }), true);
	});

	it.each(["granola.ai", "www.granola.ai", "app.granola.ai", "notes.granola.ai.example.com"])("leaves %s alone", (hostname) => {
		assert.equal(granolaSiteRules.matches({ url: `https://${hostname}/d/sample`, hostname }), false);
	});
});

describe("granolaSiteRules.transform", () => {
	it("lifts the read-only editor node out as the whole body", () => {
		const { document } = parseHTML(sharedNotePage());

		granolaSiteRules.transform({ document });

		assert.equal(document.querySelectorAll('[role="dialog"]').length, 0);
		assert.equal(document.querySelectorAll("main").length, 0);
		assert.equal(document.querySelectorAll("body > .tiptap.ProseMirror > ul > li > .node-paragraph").length, 12);
	});

	it("leaves a page with no editor node untouched", () => {
		const html =
			"<!DOCTYPE html><html><head><title>Sample planning meeting</title></head><body>" +
			'<div id="__next"><h1>Sample planning meeting</h1></div>' +
			SHARE_DIALOG +
			"</body></html>";
		const { document } = parseHTML(html);
		const before = document.toString();

		granolaSiteRules.transform({ document });

		assert.equal(document.toString(), before);
	});
});

describe("granolaSiteRules end-to-end through parseHtml", () => {
	const parser = (siteRules: Parameters<typeof initReadabilityParser>[0]["siteRules"]) =>
		initReadabilityParser({
			crawlArticle: async () => ({ status: "fetched" as const, html: "", bodyHash: "a".repeat(64) }),
			siteRules,
			readabilityAdditions,
			logError: () => {},
		});

	it("returns the shared note instead of the anonymous-viewer share dialog", () => {
		const { parseHtml } = parser([granolaSiteRules]);

		const result = parseHtml({ url: SHARED_NOTE_URL, documentUrl: SHARED_NOTE_URL, html: sharedNotePage(), thumbnailUrl: null });

		assert.equal(result.ok, true);
		assert(result.ok);
		assert.match(result.article.content, /sample migration ships in two stages/);
		assert.match(result.article.content, /Item 0\./);
		assert.match(result.article.content, /Item 11\./);
		assert.doesNotMatch(result.article.content, /shared these notes with you/);
	});
});
