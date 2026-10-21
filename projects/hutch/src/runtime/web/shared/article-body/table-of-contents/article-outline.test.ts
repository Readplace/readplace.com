import { JSDOM } from "jsdom";
import { articleBody } from "@packages/test-fixtures";
import { prepareReaderContent } from "../reader-slot/reader-content";
import { buildArticleOutline, type OutlineEntry } from "./article-outline";

const APP_ORIGIN = "https://readplace.com";
const TITLE = "Field notes";

function outlineOf(input: { content: string; title: string | undefined }): readonly OutlineEntry[] {
	const { html } = prepareReaderContent({ content: articleBody(input.content), appOrigin: APP_ORIGIN });
	return buildArticleOutline({ html, title: input.title });
}

function labels(entries: readonly OutlineEntry[]): unknown[] {
	return entries.map((entry) => (entry.children.length === 0 ? entry.label : { [entry.label]: labels(entry.children) }));
}

function bodyIds(content: string): string[] {
	const { html } = prepareReaderContent({ content: articleBody(content), appOrigin: APP_ORIGIN });
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
	return Array.from(doc.querySelectorAll("h2[id], h3[id]"), (heading) => heading.id);
}

function anchorIds(entries: readonly OutlineEntry[]): string[] {
	return entries.flatMap((entry) => [entry.anchorId, ...anchorIds(entry.children)]);
}

describe("buildArticleOutline — the leading title", () => {
	it("leaves an article whose only heading repeats its title with no entries", () => {
		expect(labels(outlineOf({ content: "<h2>Field Notes</h2><p>One</p>", title: TITLE }))).toEqual([]);
	});

	it("keeps a genuine single section", () => {
		expect(labels(outlineOf({ content: "<p>Intro</p><h2>Method</h2><p>One</p>", title: TITLE }))).toEqual(["Method"]);
	});

	it("keeps a title match that follows an introduction", () => {
		expect(labels(outlineOf({ content: "<p>Intro</p><h2>Field notes</h2><p>One</p>", title: TITLE }))).toEqual([
			"Field notes",
		]);
	});

	it("keeps a later section that matches the title", () => {
		expect(
			labels(outlineOf({ content: "<h2>Overview</h2><p>One</p><h2>Field notes</h2><p>Two</p>", title: TITLE })),
		).toEqual(["Overview", "Field notes"]);
	});

	it("drops a leading match that only whitespace and media precede, at either level", () => {
		expect([
			labels(outlineOf({ content: "\n  <figure><img src=\"https://example.com/a.png\"></figure>\n<h2>Field notes</h2><h2>Method</h2>", title: TITLE })),
			labels(outlineOf({ content: "<h3>Field notes</h3><h2>Method</h2>", title: TITLE })),
		]).toEqual([["Method"], ["Method"]]);
	});

	it("skips an empty leading heading when finding the first one", () => {
		expect(labels(outlineOf({ content: "<h2>\u200B</h2><h2>Field notes</h2><h2>Method</h2>", title: TITLE }))).toEqual([
			"Method",
		]);
	});

	it("compares under NFKC, whitespace and case folding, but not punctuation", () => {
		expect([
			labels(outlineOf({ content: "<h2>  ＦＩＥＬＤ\n notes </h2><h2>Method</h2>", title: TITLE })),
			labels(outlineOf({ content: "<h2>Field notes:</h2><h2>Method</h2>", title: TITLE })),
		]).toEqual([["Method"], ["Field notes:", "Method"]]);
	});

	it("matches nothing when the article has no metadata title", () => {
		expect(labels(outlineOf({ content: "<h2>Field notes</h2><h2>Method</h2>", title: undefined }))).toEqual([
			"Field notes",
			"Method",
		]);
	});

	it("keeps the dropped title heading and its anchor in the body", () => {
		const content = "<h2>Field notes</h2><p>One</p><h2>Method</h2>";

		expect([bodyIds(content), anchorIds(outlineOf({ content, title: TITLE }))]).toEqual([
			["section-field-notes", "section-method"],
			["section-method"],
		]);
	});
});

describe("buildArticleOutline — labels", () => {
	it("reads a line break as a space and collapses whitespace", () => {
		expect(labels(outlineOf({ content: "<h2>Step 1:<br>Install\n\n  now</h2>", title: TITLE }))).toEqual([
			"Step 1: Install now",
		]);
	});

	it("drops zero-width spaces and byte-order marks, and omits a heading left with nothing", () => {
		expect(labels(outlineOf({ content: "<h2>Intro\u200B\uFEFF</h2><h2>\u200B</h2><h2>Method</h2>", title: TITLE }))).toEqual([
			"Intro",
			"Method",
		]);
	});

	it("keeps a composed emoji whole", () => {
		expect(labels(outlineOf({ content: "<h2>👩\u200D💻 Setup</h2>", title: TITLE }))).toEqual(["👩\u200D💻 Setup"]);
	});

	it.each(["#", "¶", "§", "🔗", " "])("drops a fragment permalink reading %j", (glyph) => {
		expect(labels(outlineOf({ content: `<h2>Method <a href="#method">${glyph}</a></h2>`, title: TITLE }))).toEqual([
			"Method",
		]);
	});

	it("drops a fragment link with no visible text", () => {
		expect(
			labels(outlineOf({ content: '<h2><a href="#m"><img src="https://example.com/link.svg"></a>Method</h2>', title: TITLE })),
		).toEqual(["Method"]);
	});

	it("keeps a meaningful linked heading, a fragment link with words, and a glyph that links elsewhere", () => {
		expect(
			labels(
				outlineOf({
					content:
						'<h2><a href="https://example.com/sources">Sources</a></h2>' +
						'<h2><a href="#appendix">Appendix</a></h2>' +
						'<h2>Tagged <a href="https://example.com/tags">#</a></h2>',
					title: TITLE,
				}),
			),
		).toEqual(["Sources", "Appendix", "Tagged #"]);
	});

	it("keeps repeated labels as separate entries", () => {
		const entries = outlineOf({ content: "<h2>Example</h2><p>One</p><h2>Example</h2><p>Two</p>", title: TITLE });

		expect(entries.map((entry) => [entry.anchorId, entry.label])).toEqual([
			["section-example", "Example"],
			["section-example-2", "Example"],
		]);
	});
});

describe("buildArticleOutline — hierarchy", () => {
	it("nests each h3 under the h2 before it", () => {
		expect(
			labels(outlineOf({ content: "<h2>Setup</h2><h3>Install</h3><h3>Configure</h3><h2>Usage</h2>", title: TITLE })),
		).toEqual([{ Setup: ["Install", "Configure"] }, "Usage"]);
	});

	it("keeps an h3 with no h2 before it at the top level", () => {
		expect(labels(outlineOf({ content: "<h3>Prelude</h3><h2>Body</h2><h3>Detail</h3>", title: TITLE }))).toEqual([
			"Prelude",
			{ Body: ["Detail"] },
		]);
	});

	it("lifts the h3s under a dropped title or an empty h2 to the top level", () => {
		expect([
			labels(outlineOf({ content: "<h2>Field notes</h2><h3>Setup</h3><h3>Usage</h3><h2>Results</h2><h3>Table</h3>", title: TITLE })),
			labels(outlineOf({ content: "<h2>Results</h2><h3>Table</h3><h2>\u200B</h2><h3>Chart</h3>", title: TITLE })),
		]).toEqual([
			["Setup", "Usage", { Results: ["Table"] }],
			[{ Results: ["Table"] }, "Chart"],
		]);
	});
});

describe("buildArticleOutline — anchors", () => {
	it("links every entry to a heading id the body holds, including suffixed and numbered ones", () => {
		const content =
			"<h2>Field notes</h2><h2>Design</h2><h3>Design</h3><h2>\u200B</h2><h2>!!!</h2><h3>Design</h3><h2>Method <a href=\"#m\">¶</a></h2>";

		const ids = anchorIds(outlineOf({ content, title: TITLE }));

		expect(ids).toEqual(["section-design", "section-design-2", "section-5", "section-design-3", "section-method"]);
		expect(ids.every((id) => bodyIds(content).includes(id))).toBe(true);
	});

	it("leaves out headings of only invisible characters or a permalink glyph, whether or not the body anchored them", () => {
		const content =
			'<h2>\u200B</h2><h2>\uFEFF</h2><h2><a href="#a">¶</a></h2><h3>\u200B<a href="#b">🔗</a></h3><h2><a href="#c"></a></h2><h2>Method</h2>';

		const ids = anchorIds(outlineOf({ content, title: TITLE }));

		expect(ids).toEqual(["section-method"]);
		expect(ids.every((id) => bodyIds(content).includes(id))).toBe(true);
	});
});
