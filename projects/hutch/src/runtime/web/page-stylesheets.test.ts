import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { addPageStylesheet, findPageStylesheetByName } from "./page-stylesheets";

describe("page stylesheets", () => {
	it("derives a hashed, same-origin href from the name and css", () => {
		const css = ".a { color: red; }";
		const stylesheet = addPageStylesheet({ name: "alpha", css });
		const expectedHash = createHash("sha256").update(css).digest("hex").slice(0, 12);

		assert.equal(stylesheet.css, css);
		assert.equal(stylesheet.href, `/styles/alpha.${expectedHash}.css`);
		assert.match(stylesheet.href, /^\/styles\/alpha\.[a-f0-9]{12}\.css$/);
	});

	it("produces the same href for identical css and a different href when css changes", () => {
		const first = addPageStylesheet({ name: "beta", css: ".b { color: red; }" });
		const recomputed = createHash("sha256").update(".b { color: red; }").digest("hex").slice(0, 12);
		assert.equal(first.href, `/styles/beta.${recomputed}.css`);

		const differentCssHash = createHash("sha256").update(".b { color: blue; }").digest("hex").slice(0, 12);
		assert.notEqual(recomputed, differentCssHash);
	});

	it("looks a registered stylesheet up by name", () => {
		const stylesheet = addPageStylesheet({ name: "gamma", css: ".c {}" });
		assert.deepEqual(findPageStylesheetByName("gamma"), stylesheet);
	});

	it("returns undefined for an unregistered name", () => {
		assert.equal(findPageStylesheetByName("never-registered"), undefined);
	});

	it("rejects registering the same name twice", () => {
		addPageStylesheet({ name: "delta", css: ".d {}" });
		assert.throws(() => addPageStylesheet({ name: "delta", css: ".d-again {}" }));
	});
});
