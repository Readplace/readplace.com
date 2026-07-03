import { condenseCandidateHtml } from "./condense-candidate-html";

// Comfortably above every fixture here so condensing runs; the raw-return guard
// (input longer than the cap) is exercised on its own with a tiny cap below.
const CAP = 10_000_000;

describe("condenseCandidateHtml", () => {
	it("drops href, class, style, id, and data-* attributes but keeps tags and prose", () => {
		const out = condenseCandidateHtml(
			'<article class="post" id="a" data-id="x"><h1 style="color:red">Title</h1><a href="/foo">link</a></article>',
			CAP,
		);

		expect(out).not.toContain("href");
		expect(out).not.toContain("class=");
		expect(out).not.toContain("style=");
		expect(out).not.toContain("data-id");
		expect(out).not.toMatch(/id="a"/);
		expect(out).toContain("<article>");
		expect(out).toContain("<h1>Title</h1>");
		expect(out).toContain("<a>link</a>");
	});

	it("removes comment nodes at any depth", () => {
		const out = condenseCandidateHtml("<!-- top --><div><p>text<!-- inner --></p></div>", CAP);

		expect(out).not.toContain("<!--");
		expect(out).not.toContain("top");
		expect(out).not.toContain("inner");
		expect(out).toContain("<p>text</p>");
	});

	it("removes script and style subtrees including their text", () => {
		const out = condenseCandidateHtml(
			"<div><script>var x = 1 < 2;</script><style>.a{color:red}</style><p>keep</p></div>",
			CAP,
		);

		expect(out).not.toContain("var x");
		expect(out).not.toContain("color:red");
		expect(out).toContain("<p>keep</p>");
	});

	it("collapses whitespace runs to single spaces and trims", () => {
		const out = condenseCandidateHtml("  <p>a\n\n\t  b</p>   ", CAP);

		expect(out).toBe("<p>a b</p>");
	});

	it("keeps chrome anti-signal text the model keys on", () => {
		const out = condenseCandidateHtml(
			'<div class="byline">5 min read</div><div>Join Medium for free</div>',
			CAP,
		);

		expect(out).toContain("5 min read");
		expect(out).toContain("Join Medium for free");
	});

	it("preserves literal markup that appears as text inside code samples", () => {
		const out = condenseCandidateHtml(
			'<pre><code>if (a &lt; b) { class="x" href="y" }</code></pre>',
			CAP,
		);

		expect(out).toContain("&lt;");
		expect(out).toContain('class="x"');
		expect(out).toContain('href="y"');
	});

	it("returns the input unchanged for an empty string", () => {
		expect(condenseCandidateHtml("", CAP)).toBe("");
	});

	it("shrinks well-formed markup-heavy input", () => {
		const input =
			'<article class="post" data-track="1"><!-- c --><h1 style="x">   Long   heading   </h1><p>body</p></article>';
		const out = condenseCandidateHtml(input, CAP);

		expect(out.length).toBeLessThanOrEqual(input.length);
	});

	it("returns input longer than the cap raw and unparsed, so a giant page cannot OOM the DOM build", () => {
		const input = '<article class="post"><p>body</p></article>';

		const out = condenseCandidateHtml(input, 5);

		expect(out).toBe(input);
	});
});
