import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { imageUrls, isHeading, walk, walkNodes } from "./content-walk";
import { isUnowned } from "./owned-nodes";

const PAGE = "https://example.com/guide/page";

function root(html: string): HTMLElement {
	return parseHTML(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`).document.body;
}

function blocksOf(html: string, documentUrl: string | undefined = PAGE) {
	return walk({ root: root(html), documentUrl, isOwned: (el) => !isUnowned(el) });
}

describe("walk", () => {
	it("joins inline text into one run and splits runs at block elements and <br>", () => {
		expect(blocksOf("<div>Lead <b>bold</b> <a href='#x'>link</a><br>Second line<p>Para</p>Tail</div>")).toEqual([
			{ kind: "text", text: "Lead bold link" },
			{ kind: "text", text: "Second line" },
			{ kind: "text", text: "Para" },
			{ kind: "text", text: "Tail" },
		]);
	});

	it("emits headings and code blocks without descending into them", () => {
		expect(blocksOf("<h2>Title <span>here</span></h2><pre>git  rebase\n  -i</pre>")).toEqual([
			{ kind: "heading", text: "Title here" },
			{ kind: "code", text: "git rebase -i" },
		]);
	});

	it("reads a heading or code block from its owned text only", () => {
		expect(blocksOf("<h2>T<span hidden>secret</span></h2><pre>npm install<button>Copy</button><!-- c --></pre>")).toEqual([
			{ kind: "heading", text: "T" },
			{ kind: "code", text: "npm install" },
		]);
	});

	it("pairs each data cell with the header of its own column", () => {
		const html =
			"<table><tr><td></td><th>Price</th><th>Stock</th></tr><tr><td>Apple</td><td>3</td><td>10</td></tr></table>";
		expect(blocksOf(html).filter((block) => block.kind === "cell")).toEqual([
			{ kind: "cell", rowKey: "Apple", header: "Price", value: "3" },
			{ kind: "cell", rowKey: "Apple", header: "Stock", value: "10" },
		]);
	});

	it("skips a data cell whose column header is not a header cell", () => {
		const html =
			"<table><tr><th>K</th><td>plain</td><th>A</th><th>B</th></tr><tr><td>k</td><td>x</td><td>y</td><td>z</td></tr></table>";
		expect(blocksOf(html).filter((block) => block.kind === "cell")).toEqual([
			{ kind: "cell", rowKey: "k", header: "A", value: "y" },
			{ kind: "cell", rowKey: "k", header: "B", value: "z" },
		]);
	});

	it("skips unowned elements and comments", () => {
		expect(blocksOf("<p>Kept</p><nav>Menu</nav><!-- note --><div hidden>Hidden</div>")).toEqual([
			{ kind: "text", text: "Kept" },
		]);
	});

	it("emits an image without breaking the surrounding run", () => {
		expect(blocksOf('<p>Before <img src="/map.png"> after</p>')).toEqual([
			{ kind: "image", urls: ["https://example.com/map.png"] },
			{ kind: "text", text: "Before after" },
		]);
	});

	it("emits an association per data cell of a headed table, then its cells as runs", () => {
		const table =
			"<table><tr><th>Trophy</th><th>Rarity</th><th>Type</th></tr>" +
			"<tr><td>First</td><td>Common</td><td>Bronze</td><td>extra</td></tr>" +
			`<tr><td>Second</td><td>${"long ".repeat(13)}</td><td> </td></tr>` +
			"<tr></tr></table>";
		const blocks = blocksOf(table);
		expect(blocks.filter((block) => block.kind === "cell")).toEqual([
			{ kind: "cell", rowKey: "First", header: "Rarity", value: "Common" },
			{ kind: "cell", rowKey: "First", header: "Type", value: "Bronze" },
		]);
		expect(blocks.filter((block) => block.kind === "text").map((block) => block.kind === "text" && block.text)).toContain(
			"Common",
		);
	});

	it.each([
		["a single header", "<table><tr><th>Only</th><td>x</td></tr><tr><td>a</td><td>b</td></tr></table>"],
		["no data row", "<table><tr><th>A</th><th>B</th></tr></table>"],
		["no row at all", "<table></table>"],
	])("emits no association for a table with %s", (_name, html) => {
		expect(blocksOf(html).some((block) => block.kind === "cell")).toBe(false);
	});

	it("leaves the rows of a nested table to that table", () => {
		const html =
			"<table><tr><th>A</th><th>B</th></tr><tr><td>k</td><td>" +
			"<table><tr><th>C</th><th>D</th></tr><tr><td>n</td><td>v</td></tr></table></td></tr></table>";
		const cells = blocksOf(html).filter((block) => block.kind === "cell");
		expect(cells).toEqual([
			{ kind: "cell", rowKey: "k", header: "B", value: "C D n v" },
			{ kind: "cell", rowKey: "n", header: "D", value: "v" },
		]);
	});

	it("walks a given list of nodes", () => {
		const body = root("<h2>One</h2><p>a b</p><h2>Two</h2>");
		const nodes = [...body.childNodes].slice(0, 2);
		expect(walkNodes({ nodes, documentUrl: PAGE, isOwned: () => true })).toEqual([
			{ kind: "heading", text: "One" },
			{ kind: "text", text: "a b" },
		]);
	});
});

function imageOf(html: string, documentUrl: string | undefined = PAGE): readonly string[] {
	const el = root(html).firstElementChild;
	assert(el !== null);
	return imageUrls({ el, documentUrl });
}

describe("imageUrls", () => {
	it("prefers lazy attributes over src and srcset", () => {
		expect(
			imageOf('<img src="/placeholder.gif" data-src="/a.png" data-original="/b.png" data-srcset="/c.png 2x, /d.png 3x">'),
		).toEqual([
			"https://example.com/a.png",
			"https://example.com/b.png",
			"https://example.com/c.png",
			"https://example.com/d.png",
		]);
	});

	it("uses a lazy srcset alone", () => {
		expect(imageOf('<img src="/p.gif" data-srcset="/c.png 2x">')).toEqual(["https://example.com/c.png"]);
	});

	it("reads src and srcset when no lazy attribute is present", () => {
		expect(imageOf('<img src="a.png#frag" srcset="a.png 1x, b.png 2x">')).toEqual([
			"https://example.com/guide/a.png",
			"https://example.com/guide/b.png",
		]);
	});

	it("reads every source and image of a picture", () => {
		expect(imageOf('<picture><source srcset="/w.webp"><source><img src="/f.jpg"></picture>')).toEqual([
			"https://example.com/w.webp",
			"https://example.com/f.jpg",
		]);
	});

	it("drops non-http urls, proven tracking pixels and unparseable urls", () => {
		expect(imageOf('<img srcset="data:image/gif;base64,R0 1x, https://www.facebook.com/tr 2x, http://[ 3x">')).toEqual([]);
	});

	it("keeps absolute urls when there is no document url", () => {
		expect(imageOf('<img src="https://cdn.example.com/x.png">', undefined)).toEqual(["https://cdn.example.com/x.png"]);
	});

	it("emits no image block for an image without urls", () => {
		expect(blocksOf("<p><img alt='nothing'></p>")).toEqual([]);
	});
});

describe("isHeading", () => {
	it("recognises h1 to h6 only", () => {
		const body = root("<h6>x</h6><header>y</header>");
		expect([...body.children].map(isHeading)).toEqual([true, false]);
	});
});
