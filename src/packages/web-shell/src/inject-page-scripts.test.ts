import assert from "node:assert/strict";
import { injectPageScriptsIntoMain } from "./inject-page-scripts";

describe("injectPageScriptsIntoMain", () => {
	it("inserts the scripts immediately before </main>", () => {
		const result = injectPageScriptsIntoMain(
			"<main><p>Body</p></main>",
			'<script src="/client-dist/reader-iframe.client.js" defer></script>',
		);
		expect(result).toBe(
			'<main><p>Body</p><script src="/client-dist/reader-iframe.client.js" defer></script></main>',
		);
	});

	it("inserts before the closing tag even when <main> carries attributes", () => {
		const result = injectPageScriptsIntoMain(
			'<main class="queue" id="x">content</main>',
			"<script>run()</script>",
		);
		expect(result).toBe('<main class="queue" id="x">content<script>run()</script></main>');
	});

	it("returns the content untouched when there are no page scripts", () => {
		const content = "<main><p>Body</p></main>";
		expect(injectPageScriptsIntoMain(content, "")).toBe(content);
	});

	it("asserts when scripts are provided but the content has no <main>", () => {
		assert.throws(
			() => injectPageScriptsIntoMain("<section>No main here</section>", "<script></script>"),
			/must contain a <main> element/,
		);
	});

	it("preserves HTML escaping byte-for-byte — no DOM round-trip decodes the reader iframe's double-escaped srcdoc", () => {
		const content = '<main><iframe data-reader-iframe srcdoc="&amp;lt;input&amp;gt;"></iframe></main>';
		const result = injectPageScriptsIntoMain(content, "<script>x</script>");
		expect(result).toBe(
			'<main><iframe data-reader-iframe srcdoc="&amp;lt;input&amp;gt;"></iframe><script>x</script></main>',
		);
	});
});
