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

	it.each(all)("snippet %s contains no <script> tags", (_label, html) => {
		expect(html).not.toMatch(/<script/i);
	});

	it.each(all)(
		"snippet %s contains no cookie assignments or JavaScript event handlers",
		(_label, html) => {
			expect(html).not.toMatch(/document\.cookie|onclick=|onload=/i);
		},
	);

	it.each(all)(
		'snippet %s must not contain rel="nofollow" — publishers endorse us and should pass link equity',
		(_label, html) => {
			expect(html).not.toMatch(/rel=["']nofollow/i);
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
		expect(html).toContain('src="http://localhost:3700/icon.svg"');
	});

	it("should substitute both origins independently when each is overridden", () => {
		const html = renderSnippet("a", {
			appOrigin: "http://127.0.0.1:9999",
			embedOrigin: "http://localhost:3700",
			pageUrl: "PAGE_URL",
		});
		expect(html).toContain('href="http://127.0.0.1:9999/save?url=PAGE_URL"');
		expect(html).toContain('src="http://localhost:3700/icon.svg"');
	});

	it("should leave the embed icon URL untouched when only the app origin is overridden", () => {
		const html = renderSnippet("a", {
			appOrigin: "http://127.0.0.1:9999",
			embedOrigin: "https://readplace.com/embed",
			pageUrl: "PAGE_URL",
		});
		expect(html).toContain('src="https://readplace.com/embed/icon.svg"');
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
