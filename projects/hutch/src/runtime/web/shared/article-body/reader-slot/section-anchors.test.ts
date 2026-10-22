import { JSDOM } from "jsdom";
import { anchorArticleSections } from "./section-anchors";

function headingIds(html: string): (string | null)[] {
	const doc = new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
	return Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"), (heading) =>
		heading.getAttribute("id"),
	);
}

describe("anchorArticleSections", () => {
	it("gives each h2 and h3 a section id in document order", () => {
		const anchored = anchorArticleSections(
			"<h2>Alpha</h2><p>One</p><h3>Beta</h3><p>Two</p><h2>Gamma</h2>",
		);

		expect(headingIds(anchored)).toEqual(["section-alpha", "section-beta", "section-gamma"]);
	});

	it("reads a line break inside a heading as a space, keeping the heading's own markup", () => {
		const anchored = anchorArticleSections("<h2>Step 1:<br>Install</h2>");

		expect(anchored).toBe('<h2 id="section-step-1-install">Step 1:<br>Install</h2>');
	});

	it("leaves an h4 without an id", () => {
		const anchored = anchorArticleSections("<h2>Method</h2><h4>Footnotes</h4>");

		expect(headingIds(anchored)).toEqual(["section-method", null]);
	});

	it("folds accents out of the id", () => {
		const anchored = anchorArticleSections("<h2>Introdução</h2>");

		expect(headingIds(anchored)).toEqual(["section-introducao"]);
	});

	it("keeps CJK letters in the id", () => {
		const anchored = anchorArticleSections("<h2>読書の楽しみ</h2>");

		expect(headingIds(anchored)).toEqual(["section-読書の楽しみ"]);
	});

	it("falls back to the heading's position among the anchored headings when no letter or digit is left", () => {
		const anchored = anchorArticleSections("<h2>Setup</h2><h2></h2><h3>Usage</h3><h2>!!!</h2>");

		expect(headingIds(anchored)).toEqual(["section-setup", null, "section-usage", "section-3"]);
	});

	it("caps the slug at 60 characters without leaving a trailing hyphen", () => {
		const anchored = anchorArticleSections(`<h2>${"a".repeat(59)} b</h2>`);

		expect(headingIds(anchored)).toEqual([`section-${"a".repeat(59)}`]);
	});

	it("counts the cap in code points, so a letter outside the basic plane is never split", () => {
		const anchored = anchorArticleSections(`<h2>${"𠮷".repeat(61)}</h2>`);

		expect(headingIds(anchored)).toEqual([`section-${"𠮷".repeat(60)}`]);
	});

	it("suffixes repeated headings in document order", () => {
		const anchored = anchorArticleSections("<h2>Design</h2><h3>Design</h3><h2>Design</h2>");

		expect(headingIds(anchored)).toEqual(["section-design", "section-design-2", "section-design-3"]);
	});

	it("takes the next free suffix when a heading's own slug matches an id already minted", () => {
		const anchored = anchorArticleSections("<h2>Design</h2><h2>Design</h2><h2>Design 2</h2>");

		expect(headingIds(anchored)).toEqual(["section-design", "section-design-2", "section-design-2-2"]);
	});

	it("keeps a heading named for a number clear of a positional fallback", () => {
		const anchored = anchorArticleSections("<h2>3</h2><h2>Notes</h2><h2>???</h2>");

		expect(headingIds(anchored)).toEqual(["section-3", "section-notes", "section-3-2"]);
	});

	it("gives a heading with no text, such as an image-only one, no id", () => {
		const anchored = anchorArticleSections(
			'<h2><img src="https://cdn.example.com/chart.png" alt="Chart"></h2><h2>Results</h2>',
		);

		expect(headingIds(anchored)).toEqual([null, "section-results"]);
	});

	it("clears the id of a heading it does not anchor, so a publisher's section id cannot shadow a minted one", () => {
		const anchored = anchorArticleSections(
			'<h2 id="section-results"><img src="https://cdn.example.com/chart.png" alt="Chart"></h2><h2>Results</h2>',
		);

		expect(headingIds(anchored)).toEqual([null, "section-results"]);
	});

	it("collapses the heading's whitespace before slugging it", () => {
		const anchored = anchorArticleSections("<h2>\n  Getting\n\n   started  </h2>");

		expect(headingIds(anchored)).toEqual(["section-getting-started"]);
	});
});
