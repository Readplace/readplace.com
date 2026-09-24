import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
	PAGE_URL_PLACEHOLDER,
	SNIPPET_MAX_BYTES,
	SNIPPET_VARIANTS,
	byteLength,
	renderCanonicalSnippet,
	renderLiveSnippet,
} from "./snippet.component";

function parseSnippet(html: string): Document {
	return new JSDOM(html).window.document;
}

function canonical(variant: (typeof SNIPPET_VARIANTS)[number]): string {
	return renderCanonicalSnippet({ variant, pageUrl: PAGE_URL_PLACEHOLDER });
}

describe("rendered canonical snippet byte sizes", () => {
	it.each(SNIPPET_VARIANTS)("snippet %s rendered with the placeholder page URL stays under the size limit", (variant) => {
		expect(byteLength(canonical(variant))).toBeLessThan(SNIPPET_MAX_BYTES);
	});
});

describe("rendered canonical snippet invariants", () => {
	const all = SNIPPET_VARIANTS.map((variant) => [variant.toUpperCase(), canonical(variant)] as const);

	it.each(all)("snippet %s references the canonical readplace.com save endpoint", (_label, html) => {
		expect(html).toContain("https://readplace.com/save?url=PAGE_URL&amp;save_surface=embed");
	});

	it.each(all)(
		"snippet %s declares the embed save surface, so a publisher's button is not counted as a click inside our reader",
		(_label, html) => {
			expect(html).toContain("save_surface=embed");
		},
	);

	it.each(all)(
		"snippet %s ships the dotted mark only at 33px and up, and the dotless small mark below the size cutover",
		(_label, html) => {
			const images = Array.from(parseSnippet(html).querySelectorAll("img"));
			expect(images).toHaveLength(1);
			for (const image of images) {
				const width = Number(image.getAttribute("width"));
				const expectedSrc =
					width >= 33 ? "https://readplace.com/embed/icon.svg?v=2" : "https://readplace.com/embed/icon-small.svg";
				expect(image.getAttribute("src")).toBe(expectedSrc);
			}
		},
	);

	const expectedCanonicalHtml = {
		a: '<a href="https://readplace.com/save?url=PAGE_URL&amp;save_surface=embed" title="Save to Readplace" aria-label="Save to Readplace">\n  <img src="https://readplace.com/embed/icon.svg?v=2" alt="Save to Readplace" width="36" height="36" style="display:block;margin:8px;border:0;border-radius:6px">\n</a>\n',
		b: '<a href="https://readplace.com/save?url=PAGE_URL&amp;save_surface=embed" style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:#2B3A55;color:#FFFFFF;text-decoration:none;font:600 14px/1 Inter,-apple-system,system-ui,sans-serif;border-radius:6px;border:1px solid #2B3A55">\n  <img src="https://readplace.com/embed/icon-small.svg" alt="" width="20" height="20" style="display:block;border:0">Save to Readplace\n</a>\n',
		c: '<aside style="margin:32px 0;padding:20px 24px;background:#F7F8FA;border:1px solid #E2E5EA;border-radius:8px;font-family:Inter,-apple-system,system-ui,sans-serif;color:#1A202C">\n  <div style="display:flex;align-items:flex-start;gap:16px">\n    <img src="https://readplace.com/embed/icon.svg?v=2" alt="" width="40" height="40" style="display:block;border:0;border-radius:6px;flex:none">\n    <div style="flex:1;min-width:0">\n      <h3 style="margin:0 0 6px;font:700 18px/1.3 Georgia,\'Times New Roman\',serif;color:#2B3A55">Save this for later</h3>\n      <p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#5A6170">Readplace keeps it for you to read when you have time.</p>\n      <a href="https://readplace.com/save?url=PAGE_URL&amp;save_surface=embed" style="display:inline-block;padding:8px 16px;background:#2B3A55;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;border-radius:6px;border:1px solid #2B3A55">Save to Readplace</a>\n    </div>\n  </div>\n</aside>\n',
	};

	it.each(SNIPPET_VARIANTS)(
		"snippet %s renders the exact canonical HTML — no <script>, no cookie/event handlers, no rel=nofollow, link equity preserved",
		(variant) => {
			expect(canonical(variant)).toBe(expectedCanonicalHtml[variant]);
		},
	);
});

describe("renderCanonicalSnippet with a publisher's article link", () => {
	it("encodes the link once into the save URL, so a query string of its own cannot split the save link's parameters", () => {
		const html = renderCanonicalSnippet({ variant: "a", pageUrl: "https://example.com/post?id=1&ref=feed" });
		const anchor = parseSnippet(html).querySelector("a");
		assert(anchor, "snippet A must render its save anchor");
		expect(anchor.getAttribute("href")).toBe(
			"https://readplace.com/save?url=https%3A%2F%2Fexample.com%2Fpost%3Fid%3D1%26ref%3Dfeed&save_surface=embed",
		);
	});
});

describe("renderLiveSnippet", () => {
	it("points the save link at the root-relative save endpoint, tagged with the section and element the click came from", () => {
		const html = renderLiveSnippet({
			variant: "c",
			pageUrl: "https://readplace.com/embed/",
			embedOrigin: "https://readplace.com/embed",
			tracking: { source: "embed-variants", content: "save-variant-c" },
		});
		const anchor = parseSnippet(html).querySelector("a");
		assert(anchor, "snippet C must render its save anchor");
		expect(anchor.getAttribute("href")).toBe(
			"/save?url=https%3A%2F%2Freadplace.com%2Fembed%2F&save_surface=embed&utm_source=embed-variants&utm_medium=internal&utm_content=save-variant-c",
		);
	});

	it("serves the icon from the configured embed origin so a dev server can answer it", () => {
		const html = renderLiveSnippet({
			variant: "b",
			pageUrl: "http://localhost:3700/embed/",
			embedOrigin: "http://localhost:3700/embed",
			tracking: { source: "embed-hero", content: "save-demo" },
		});
		const image = parseSnippet(html).querySelector("img");
		assert(image, "snippet B must render its icon");
		expect(image.getAttribute("src")).toBe("http://localhost:3700/embed/icon-small.svg");
	});
});

describe("byteLength", () => {
	it("should count bytes in a short ASCII string as character count", () => {
		expect(byteLength("hello")).toBe(5);
	});

	it("should count bytes correctly for multibyte UTF-8 characters", () => {
		expect(byteLength("—")).toBe(3);
	});
});
