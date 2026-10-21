import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { readabilityAdditions } from "./readability-additions";
import { initReadabilityParser } from "./readability-parser";
import { restoreRetaggedTables } from "./restore-retagged-tables";

describe("restoreRetaggedTables", () => {
	it("wraps the rows of a <tbody> that Readability retagged to <div> back into a table", () => {
		const retaggedTbody =
			"<div>\n<tr><td>1d-interleaved-parityfec</td><td>application/1d-interleaved-parityfec</td></tr>\n<tr><td>3gpdash-qoe-report+xml</td><td>application/3gpdash-qoe-report+xml</td></tr>\n</div>";

		expect(restoreRetaggedTables(retaggedTbody)).toBe(
			"<div>\n<table><tr><td>1d-interleaved-parityfec</td><td>application/1d-interleaved-parityfec</td></tr>\n<tr><td>3gpdash-qoe-report+xml</td><td>application/3gpdash-qoe-report+xml</td></tr></table>\n</div>",
		);
	});

	it("wraps a <table> that Readability retagged to <div> while it still holds its <tbody>", () => {
		const retaggedTable = "<div><tbody><tr><td>left-pad</td><td>1.3.0</td></tr><tr><td>is-odd</td><td>3.0.1</td></tr></tbody></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><table><tbody><tr><td>left-pad</td><td>1.3.0</td></tr><tr><td>is-odd</td><td>3.0.1</td></tr></tbody></table></div>",
		);
	});

	it("wraps a retagged <table> holding a <thead> beside bare rows", () => {
		const retaggedTable =
			"<div><thead><tr><th>Property</th><th>Expected Type</th></tr></thead><tr><td>acceptedAnswer</td><td>Answer</td></tr></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><table><thead><tr><th>Property</th><th>Expected Type</th></tr></thead><tr><td>acceptedAnswer</td><td>Answer</td></tr></table></div>",
		);
	});

	it("wraps a retagged <table> that kept its caption, column group, bare column and footer", () => {
		const retaggedTable =
			"<div><caption>Status codes</caption><colgroup><col></colgroup><col><tr><td>200</td><td>OK</td></tr><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><table><caption>Status codes</caption><colgroup><col></colgroup><col><tr><td>200</td><td>OK</td></tr><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></table></div>",
		);
	});

	it("wraps retagged rows that each pair a header cell with a value back into a table", () => {
		const retaggedTbody = "<div><tr><th>words</th><td>2,140</td></tr><tr><th>read time</th><td>9 min</td></tr></div>";

		expect(restoreRetaggedTables(retaggedTbody)).toBe(
			"<div><table><tr><th>words</th><td>2,140</td></tr><tr><th>read time</th><td>9 min</td></tr></table></div>",
		);
	});

	it("keeps the comment and text between retagged rows inside the rebuilt table, in order", () => {
		const retaggedTbody = "<div><tr><td>200</td><td>OK</td></tr><!-- redirects --> moved: <tr><td>301</td><td>Moved</td></tr></div>";

		expect(restoreRetaggedTables(retaggedTbody)).toBe(
			"<div><table><tr><td>200</td><td>OK</td></tr><!-- redirects --> moved: <tr><td>301</td><td>Moved</td></tr></table></div>",
		);
	});

	it("turns the cells of a retagged row into blocks, since a single row lays its cells out side by side", () => {
		const retaggedRow = "<div><td><p>11.Aug.2026</p></td><td><h1>Obituary</h1><p>Dr. Tim King passed away.</p></td></div>";

		expect(restoreRetaggedTables(retaggedRow)).toBe(
			"<div><div><p>11.Aug.2026</p></div><div><h1>Obituary</h1><p>Dr. Tim King passed away.</p></div></div>",
		);
	});

	it("turns a retagged single-row table into blocks", () => {
		const retaggedTable =
			"<div><tr><td>Follow: performs routine tasks</td><td>Assist: provides assistance</td><td>Apply: performs varied tasks</td></tr></div>";

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			"<div><div><div>Follow: performs routine tasks</div><div>Assist: provides assistance</div><div>Apply: performs varied tasks</div></div></div>",
		);
	});

	it("turns a single-column table into blocks and leaves the tables nested in its cells as they are", () => {
		const retaggedTable =
			'<div><tbody><tr><td><table><tr><td><img src="s.gif" width="0"></td><td>First comment</td></tr></table></td></tr><tr><td><table><tr><td><img src="s.gif" width="40"></td><td>A reply</td></tr></table></td></tr></tbody></div>';

		expect(restoreRetaggedTables(retaggedTable)).toBe(
			'<div><div><div><div><table><tr><td><img src="s.gif" width="0"></td><td>First comment</td></tr></table></div></div><div><div><table><tr><td><img src="s.gif" width="40"></td><td>A reply</td></tr></table></div></div></div></div>',
		);
	});

	it("turns a retagged single-cell layout table into blocks that keep their attributes", () => {
		const retaggedLayoutTable =
			'<div width="435"><tr><td id="essay"><font size="2" face="verdana">April 2001<br><br>This essay is derived from a talk.</font></td></tr></div>';

		expect(restoreRetaggedTables(retaggedLayoutTable)).toBe(
			'<div width="435"><div><div id="essay"><font size="2" face="verdana">April 2001<br><br>This essay is derived from a talk.</font></div></div></div>',
		);
	});

	it("keeps text that sits beside a retagged row apart from the row's text", () => {
		const leadAndRow = "<div>Lead<tr><td>cell</td></tr></div>";

		expect(restoreRetaggedTables(leadAndRow)).toBe("<div>Lead<div><div>cell</div></div></div>");
	});

	it("turns a header cell nested in a single cell into a block of its own", () => {
		const retaggedLayoutTable = "<div><tr><td>Essay text<th>Note</th></td></tr></div>";

		expect(restoreRetaggedTables(retaggedLayoutTable)).toBe("<div><div><div>Essay text<div>Note</div></div></div></div>");
	});

	it("turns a cell that an unclosed paragraph swallowed into a block", () => {
		const imageCaptionParagraph =
			'<p><i>GlobeView pitch and bearing</i><td><img src="https://deck.example/b.png"><p><i>Controller maxBounds</i></p></td></p>';

		expect(restoreRetaggedTables(imageCaptionParagraph)).toBe(
			'<p><i>GlobeView pitch and bearing</i><div><img src="https://deck.example/b.png"><p><i>Controller maxBounds</i></p></div></p>',
		);
	});

	it("turns a row that an unclosed paragraph swallowed into blocks", () => {
		const captionAndRow = "<p><i>PopupWidget</i><tr><td>SplitterWidget</td></tr></p>";

		expect(restoreRetaggedTables(captionAndRow)).toBe("<p><i>PopupWidget</i><div><div>SplitterWidget</div></div></p>");
	});

	it("rebuilds a grid after turning the cell a paragraph inside one of its cells swallowed into a block", () => {
		const retaggedTbody =
			"<div><tr><td><p><i>Globe view</i><td>Terrain layer</td></p></td><td>v9.2</td></tr><tr><td>Widgets</td><td>v9.1</td></tr></div>";

		expect(restoreRetaggedTables(retaggedTbody)).toBe(
			"<div><table><tr><td><p><i>Globe view</i><div>Terrain layer</div></p></td><td>v9.2</td></tr><tr><td>Widgets</td><td>v9.1</td></tr></table></div>",
		);
	});

	it("settles table parts split by a paragraph as two separate runs", () => {
		const splitRuns = "<div><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr><p>between</p><tr><td>e</td></tr></div>";

		expect(restoreRetaggedTables(splitRuns)).toBe(
			"<div><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table><p>between</p><div><div>e</div></div></div>",
		);
	});

	it("returns a body whose table parts all sit inside a <table> exactly as given", () => {
		const wellFormedTable = "<table class=grid><tr><td>a<br/>b</td></tr></table>";

		expect(restoreRetaggedTables(wellFormedTable)).toBe("<table class=grid><tr><td>a<br/>b</td></tr></table>");
	});
});

describe("restoreRetaggedTables keeps every text node in order and leaves no table part outside a table", () => {
	function tablePartsOutsideATable(html: string): string[] {
		const { document } = parseHTML(`<div id="root">${html}</div>`);
		const root = document.getElementById("root");
		assert(root);
		return Array.from(root.querySelectorAll("caption,colgroup,col,thead,tbody,tfoot,tr,td,th"))
			.filter((part) => part.closest("table") === null)
			.map((part) => part.tagName);
	}

	function textNodesOf(html: string): string[] {
		const { document } = parseHTML(`<div id="root">${html}</div>`);
		const root = document.getElementById("root");
		assert(root);
		const texts: string[] = [];
		const collect = (node: Node): void => {
			if (node.nodeName === "#text") texts.push(String(node.textContent));
			for (const child of Array.from(node.childNodes)) collect(child);
		};
		collect(root);
		return texts;
	}

	it.each([
		["a retagged <tbody>", "<div>\n<tr><td>a</td><td>b</td></tr>\n<tr><td>c</td><td>d</td></tr>\n</div>"],
		["a retagged row of bare cells", "<div><td><p>11.Aug.2026</p></td><td><h1>Obituary</h1><p>Text</p></td></div>"],
		["a single-column table around nested tables", "<div><tbody><tr><td><table><tr><td>x</td><td>First</td></tr></table></td></tr><tr><td><table><tr><td>y</td><td>Reply</td></tr></table></td></tr></tbody></div>"],
		["text beside a sole cell", "<div>Lead<tr><td>cell</td></tr>Tail</div>"],
		["a header cell nested in a cell", "<div><tr><td>Essay text<th>Note</th></td></tr></div>"],
		["cells an unclosed paragraph swallowed", "<p><i>Caption</i><td><img src=a.png><p><i>Next</i><td><img src=b.png><p><i>Last</i></p></td></p></td></p>"],
		["a swallowed cell inside a grid", "<div><tr><td><p><i>Globe</i><td>Terrain</td></p></td><td>v9.2</td></tr><tr><td>Widgets</td><td>v9.1</td></tr></div>"],
		["runs split by text and a paragraph", "<div><tr><td>a</td><td>b</td></tr>loose<tr><td>c</td><td>d</td></tr><p>between</p><tr><td>e</td></tr></div>"],
	])("on %s", (_shape, html) => {
		const restored = restoreRetaggedTables(html);

		expect({ outside: tablePartsOutsideATable(restored), texts: textNodesOf(restored), again: restoreRetaggedTables(restored) }).toEqual({
			outside: [],
			texts: textNodesOf(html),
			again: restored,
		});
	});
});

describe("restoreRetaggedTables end-to-end through parseHtml", () => {
	const { parseHtml } = initReadabilityParser({
		crawlArticle: async () => ({ status: "fetched" as const, html: "", bodyHash: "a".repeat(64) }),
		siteRules: [],
		readabilityAdditions,
		logError: () => {},
	});

	function contentOf(params: { url: string; html: string }): string {
		const result = parseHtml({ url: params.url, documentUrl: params.url, html: params.html, thumbnailUrl: null });
		assert(result.ok);
		return result.article.content;
	}

	it("keeps a registry's rows in a table after Readability retags its <tbody> to <div>", () => {
		const registryPage =
			"<html><head><title>Media Types</title></head><body><table><thead><tr><th>Name</th><th>Reference</th></tr></thead><tbody><tr><td>alpha</td><td>Registered by the alpha working group, see RFC 9001</td></tr><tr><td>beta</td><td>Registered by the beta working group, see RFC 9002</td></tr><tr><td>gamma</td><td>Registered by the gamma working group, see RFC 9003</td></tr></tbody></table></body></html>";

		expect(contentOf({ url: "https://registry.example/media-types", html: registryPage })).toBe(
			'<div class="page" id="readability-page-1"><div><table><tr><td>alpha</td><td>Registered by the alpha working group, see RFC 9001</td></tr><tr><td>beta</td><td>Registered by the beta working group, see RFC 9002</td></tr><tr><td>gamma</td><td>Registered by the gamma working group, see RFC 9003</td></tr></table></div></div>',
		);
	});

	it("turns a news page's two-cell layout row into blocks after Readability retags its table", () => {
		const newsPage =
			"<html><head><title>Obituary</title></head><body><table><tr><td><p>11.Aug.2026, by Ravi Abbott</p></td><td><p>Dr. Tim King passed away at the end of July, his family confirmed upon request.</p></td></tr></table></body></html>";

		expect(contentOf({ url: "https://news.example/obituary", html: newsPage })).toBe(
			'<div class="page" id="readability-page-1"><div><div><div><p>11.Aug.2026, by Ravi Abbott</p></div><div><p>Dr. Tim King passed away at the end of July, his family confirmed upon request.</p></div></div></div></div>',
		);
	});

	it("turns a thread's single-column comment table into blocks around each comment's own table", () => {
		const threadPage =
			'<html><head><title>Thread</title></head><body><table><tbody><tr><td><table><tr><td><img src="s.gif" width="0"></td><td><p>I have used a similar technique with my own tools, and it helps to save context overall.</p><p>It also keeps the first prompt small, which matters for long sessions.</p></td></tr></table></td></tr><tr><td><table><tr><td><img src="s.gif" width="40"></td><td><p>Simply loading the browser skill alone, with its instructions, costs a lot of context.</p><p>Deferring the details until they are needed, as you describe, avoids that cost.</p></td></tr></table></td></tr></tbody></table></body></html>';

		expect(contentOf({ url: "https://forum.example/item", html: threadPage })).toBe(
			'<div class="page" id="readability-page-1"><div><div><div><div><table><tr><td><img src="https://forum.example/s.gif" width="0"></td><td><p>I have used a similar technique with my own tools, and it helps to save context overall.</p><p>It also keeps the first prompt small, which matters for long sessions.</p></td></tr></table></div></div><div><div><table><tr><td><img src="https://forum.example/s.gif" width="40"></td><td><p>Simply loading the browser skill alone, with its instructions, costs a lot of context.</p><p>Deferring the details until they are needed, as you describe, avoids that cost.</p></td></tr></table></div></div></div></div></div>',
		);
	});

	it("turns the image cells that unclosed caption paragraphs swallowed into blocks", () => {
		const galleryPage =
			'<html><head><title>Whats new</title></head><body><article><p>Version 9.4 adds WebGPU support, an improved globe view, and new layout tools for widgets.</p><table><tr><td><img src="globe.png"><p><i>Globe view pitch and bearing</i><td><img src="bounds.png"><p><i>Controller bounds and rubber band</i></tr></table><p>Version 9.3 added a terrain extension, a collision filter, and faster picking for large layers.</p></article></body></html>';

		expect(contentOf({ url: "https://docs.example/whats-new", html: galleryPage })).toBe(
			'<div class="page" id="readability-page-1"><article><p>Version 9.4 adds WebGPU support, an improved globe view, and new layout tools for widgets.</p><div><img src="https://docs.example/globe.png"><p><i>Globe view pitch and bearing</i></p><div><img src="https://docs.example/bounds.png"><p><i>Controller bounds and rubber band</i></p></div><p></p></div><p>Version 9.3 added a terrain extension, a collision filter, and faster picking for large layers.</p></article></div>',
		);
	});
});
