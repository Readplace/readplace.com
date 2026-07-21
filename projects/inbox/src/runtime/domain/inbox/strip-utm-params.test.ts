import { stripUtmParams } from "./strip-utm-params";

describe("stripUtmParams", () => {
	it("drops utm_* params a newsletter tagged the link with", () => {
		expect(stripUtmParams("https://example.com/post?utm_source=nl&utm_medium=email")).toBe(
			"https://example.com/post",
		);
	});

	it("keeps the surviving params in the order the newsletter sent them, not sorted", () => {
		expect(stripUtmParams("https://example.com/post?b=2&utm_source=nl&a=1")).toBe(
			"https://example.com/post?b=2&a=1",
		);
	});

	it("keeps params that only the article-identity stripper treats as tracking", () => {
		expect(stripUtmParams("https://example.com/post?gi=abc&source=rss&sk=xyz&utm_source=nl")).toBe(
			"https://example.com/post?gi=abc&source=rss&sk=xyz",
		);
	});

	it("keeps a param whose value could be load-bearing for the link to resolve", () => {
		expect(stripUtmParams("https://example.com/ss/c/token?j=eyJ1Ijoi&utm_campaign=weekly")).toBe(
			"https://example.com/ss/c/token?j=eyJ1Ijoi",
		);
	});

	it("returns a URL with no query byte-identical, adding no trailing slash", () => {
		expect(stripUtmParams("https://example.com")).toBe("https://example.com");
	});

	it("returns a URL with no utm params byte-identical rather than re-serializing it", () => {
		expect(stripUtmParams("https://example.com/post?a=1&b=hello%20world")).toBe(
			"https://example.com/post?a=1&b=hello%20world",
		);
	});

	it("leaves no dangling ? when every param was utm", () => {
		expect(stripUtmParams("https://example.com/post?utm_source=nl")).toBe("https://example.com/post");
	});

	it("preserves a fragment the destination carries", () => {
		expect(stripUtmParams("https://example.com/post?utm_source=nl#pricing")).toBe(
			"https://example.com/post#pricing",
		);
	});

	it("preserves a repeated key rather than collapsing it to one", () => {
		expect(stripUtmParams("https://example.com/post?a=1&utm_source=nl&a=2")).toBe(
			"https://example.com/post?a=1&a=2",
		);
	});

	it("keeps an encoded space encoded instead of re-encoding it as +", () => {
		expect(stripUtmParams("https://example.com/post?q=hello%20world&utm_source=nl")).toBe(
			"https://example.com/post?q=hello%20world",
		);
	});

	it("matches utm_ case-sensitively, the same way the article-identity stripper does", () => {
		expect(stripUtmParams("https://example.com/post?UTM_SOURCE=nl")).toBe(
			"https://example.com/post?UTM_SOURCE=nl",
		);
	});

	it("returns an unparseable href unchanged rather than throwing at the card", () => {
		expect(stripUtmParams("not a url")).toBe("not a url");
	});

	it("returns a non-http href unchanged, since only http(s) links are ever saved", () => {
		expect(stripUtmParams("mailto:editor@example.com?utm_source=nl")).toBe(
			"mailto:editor@example.com?utm_source=nl",
		);
	});
});
