import {
	type SnippetVariant,
	byteLength,
	renderCanonicalSnippet,
	renderSnippet,
} from "./snippet.component";

const MAX_BYTES = 1024;
const VARIANTS: SnippetVariant[] = ["a", "b", "c"];

describe("rendered canonical snippet byte sizes", () => {
	it.each(VARIANTS)(
		"snippet %s rendered with canonical origins must be at most 1024 bytes",
		(variant) => {
			expect(byteLength(renderCanonicalSnippet(variant))).toBeLessThanOrEqual(MAX_BYTES);
		},
	);

	it.each(VARIANTS)(
		"snippet %s rendered with canonical origins must not be empty",
		(variant) => {
			expect(byteLength(renderCanonicalSnippet(variant))).toBeGreaterThan(0);
		},
	);
});

describe("rendered canonical snippet invariants", () => {
	const all = VARIANTS.map(
		(variant) => [variant.toUpperCase(), renderCanonicalSnippet(variant)] as const,
	);

	it.each(all)("snippet %s references the canonical readplace.com save endpoint", (_label, html) => {
		expect(html).toContain("https://readplace.com/save");
	});

	it.each(all)("snippet %s references the canonical embed origin icon URL", (_label, html) => {
		expect(html).toContain("https://readplace.com/embed/icon.svg");
	});

	const expectedCanonicalHtml: Record<SnippetVariant, string> = {
		a: '<a href="https://readplace.com/save?url=PAGE_URL" title="Save to Readplace" aria-label="Save to Readplace">\n  <img src="https://readplace.com/embed/icon.svg?v=2" alt="Save to Readplace" width="32" height="32" style="display:block;border:0;border-radius:6px">\n</a>\n',
		b: '<a href="https://readplace.com/save?url=PAGE_URL" style="display:inline-flex;align-items:center;gap:8px;padding:8px 14px;background:#2B3A55;color:#FFFFFF;text-decoration:none;font:600 14px/1 Inter,-apple-system,system-ui,sans-serif;border-radius:6px;border:1px solid #2B3A55">\n  <img src="https://readplace.com/embed/icon.svg?v=2" alt="" width="20" height="20" style="display:block;border:0">Save to Readplace\n</a>\n',
		c: '<aside style="margin:32px 0;padding:20px 24px;background:#F7F8FA;border:1px solid #E2E5EA;border-radius:8px;font-family:Inter,-apple-system,system-ui,sans-serif;color:#1A202C">\n  <div style="display:flex;align-items:flex-start;gap:16px">\n    <img src="https://readplace.com/embed/icon.svg?v=2" alt="" width="40" height="40" style="display:block;border:0;border-radius:6px;flex:none">\n    <div style="flex:1;min-width:0">\n      <h3 style="margin:0 0 6px;font:700 18px/1.3 Georgia,\'Times New Roman\',serif;color:#2B3A55">Save this for later</h3>\n      <p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#5A6170">Add it to your Readplace queue and come back when you have time.</p>\n      <a href="https://readplace.com/save?url=PAGE_URL" style="display:inline-block;padding:8px 16px;background:#2B3A55;color:#FFFFFF;text-decoration:none;font-weight:600;font-size:14px;border-radius:6px;border:1px solid #2B3A55">Save to Readplace</a>\n    </div>\n  </div>\n</aside>\n',
	};

	it.each(VARIANTS)(
		"snippet %s renders the exact canonical HTML — no <script>, no cookie/event handlers, no rel=nofollow, link equity preserved",
		(variant) => {
			expect(renderCanonicalSnippet(variant)).toBe(expectedCanonicalHtml[variant]);
		},
	);
});

describe("renderSnippet", () => {
	it("should substitute appOrigin in the save link href", () => {
		const html = renderSnippet("a", {
			appOrigin: "http://127.0.0.1:9999",
			embedOrigin: "https://readplace.com/embed",
			pageUrl: "PAGE_URL",
		});
		expect(html).toContain('href="http://127.0.0.1:9999/save?url=PAGE_URL"');
	});

	it("should substitute pageUrl in the save link href", () => {
		const html = renderSnippet("a", {
			appOrigin: "https://readplace.com",
			embedOrigin: "https://readplace.com/embed",
			pageUrl: "https://example.com/my-article",
		});
		expect(html).toContain('href="https://readplace.com/save?url=https://example.com/my-article"');
	});

	it("should substitute embedOrigin in the icon img src", () => {
		const html = renderSnippet("a", {
			appOrigin: "https://readplace.com",
			embedOrigin: "http://localhost:3700",
			pageUrl: "PAGE_URL",
		});
		expect(html).toContain('src="http://localhost:3700/icon.svg?v=2"');
	});

	it("should substitute both origins independently when each is overridden", () => {
		const html = renderSnippet("a", {
			appOrigin: "http://127.0.0.1:9999",
			embedOrigin: "http://localhost:3700",
			pageUrl: "PAGE_URL",
		});
		expect(html).toContain('href="http://127.0.0.1:9999/save?url=PAGE_URL"');
		expect(html).toContain('src="http://localhost:3700/icon.svg?v=2"');
	});

	it("should leave the embed icon URL untouched when only the app origin is overridden", () => {
		const html = renderSnippet("a", {
			appOrigin: "http://127.0.0.1:9999",
			embedOrigin: "https://readplace.com/embed",
			pageUrl: "PAGE_URL",
		});
		expect(html).toContain('src="https://readplace.com/embed/icon.svg?v=2"');
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
