import { collectEmailAnchors } from "./collect-email-anchors";

describe("collectEmailAnchors", () => {
	it("maps an href to its visible label with nested markup flattened", () => {
		const anchors = collectEmailAnchors(
			'<a href="https://a.test/x"><strong>Read</strong> the <em>essay</em></a>',
		);

		expect(anchors.get("https://a.test/x")).toBe("Read the essay");
	});

	it("decodes entity-encoded hrefs so keys match the extracted URLs", () => {
		const anchors = collectEmailAnchors('<a href="https://a.test/?x=1&amp;y=2">t</a>');

		expect(anchors.get("https://a.test/?x=1&y=2")).toBe("t");
	});

	it("collapses internal whitespace and trims the label", () => {
		const anchors = collectEmailAnchors('<a href="https://a.test/x">\n  Read\n   more \n</a>');

		expect(anchors.get("https://a.test/x")).toBe("Read more");
	});

	it("caps the label length", () => {
		const anchors = collectEmailAnchors(`<a href="https://a.test/x">${"y".repeat(300)}</a>`);

		expect(anchors.get("https://a.test/x")).toBe("y".repeat(200));
	});

	it("keeps the first label when the same href repeats", () => {
		const anchors = collectEmailAnchors(
			'<a href="https://a.test/x">First</a><a href="https://a.test/x">Second</a>',
		);

		expect(anchors.get("https://a.test/x")).toBe("First");
	});

	it("ignores anchors with no visible text", () => {
		const anchors = collectEmailAnchors('<a href="https://a.test/x"><img alt=""/></a>');

		expect(anchors.size).toBe(0);
	});
});
