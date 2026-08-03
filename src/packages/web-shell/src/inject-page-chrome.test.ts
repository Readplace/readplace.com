import assert from "node:assert/strict";
import { injectPageChromeIntoMain } from "./inject-page-chrome";

const NO_SUGGESTION = { showExtensionSuggestion: false };

describe("injectPageChromeIntoMain", () => {
	it("carries the body class onto <main> so a boosted swap can restore it", () => {
		const result = injectPageChromeIntoMain("<main><p>Body</p></main>", {
			bodyClass: "page-reader",
			...NO_SUGGESTION,
		});
		expect(result).toBe(
			'<main data-page-class="page-reader" data-extension-suggestion="false"><p>Body</p></main>',
		);
	});

	it("carries the destination's extension-suggestion answer", () => {
		const result = injectPageChromeIntoMain("<main>c</main>", {
			bodyClass: "page-reader",
			showExtensionSuggestion: true,
		});
		expect(result).toBe(
			'<main data-page-class="page-reader" data-extension-suggestion="true">c</main>',
		);
	});

	it("keeps the existing attributes when adding the markers", () => {
		const result = injectPageChromeIntoMain('<main class="queue" id="x">c</main>', {
			bodyClass: "page-queue",
			...NO_SUGGESTION,
		});
		expect(result).toBe(
			'<main data-page-class="page-queue" data-extension-suggestion="false" class="queue" id="x">c</main>',
		);
	});

	it("carries a multi-token class verbatim", () => {
		const result = injectPageChromeIntoMain("<main>c</main>", {
			bodyClass: "page-reader page-reader--chromeless",
			...NO_SUGGESTION,
		});
		expect(result).toContain('data-page-class="page-reader page-reader--chromeless"');
	});

	it("marks only the first <main>", () => {
		const result = injectPageChromeIntoMain("<main>a</main><main>b</main>", {
			bodyClass: "page-queue",
			...NO_SUGGESTION,
		});
		expect(result).toBe(
			'<main data-page-class="page-queue" data-extension-suggestion="false">a</main><main>b</main>',
		);
	});

	it("omits the class marker when the page declares no body class", () => {
		const result = injectPageChromeIntoMain("<main>c</main>", {
			bodyClass: undefined,
			...NO_SUGGESTION,
		});
		expect(result).toBe('<main data-extension-suggestion="false">c</main>');
	});

	it("asserts when the content has no <main>", () => {
		assert.throws(
			() =>
				injectPageChromeIntoMain("<section>No main here</section>", {
					bodyClass: "page-queue",
					...NO_SUGGESTION,
				}),
			/must contain a <main> element/,
		);
	});

	it("asserts on a class that would break out of the attribute", () => {
		assert.throws(
			() =>
				injectPageChromeIntoMain("<main>c</main>", {
					bodyClass: 'page-x" onload="alert(1)',
					...NO_SUGGESTION,
				}),
			/plain class tokens/,
		);
	});

	it("preserves HTML escaping byte-for-byte — no DOM round-trip decodes the reader iframe's double-escaped srcdoc", () => {
		const content = '<main><iframe data-reader-iframe srcdoc="&amp;lt;input&amp;gt;"></iframe></main>';
		const result = injectPageChromeIntoMain(content, {
			bodyClass: "page-reader",
			...NO_SUGGESTION,
		});
		expect(result).toContain('srcdoc="&amp;lt;input&amp;gt;"');
	});
});
