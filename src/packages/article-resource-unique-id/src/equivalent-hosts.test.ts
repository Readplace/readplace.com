import { ArticleResourceUniqueId } from "./index";
import { equivalentHostUrls, toCanonicalHostUrl } from "./equivalent-hosts";

describe("toCanonicalHostUrl", () => {
	it("rewrites a twitter.com URL to x.com", () => {
		expect(toCanonicalHostUrl("https://twitter.com/jack/status/20")).toBe("https://x.com/jack/status/20");
	});

	it("keeps the http scheme", () => {
		expect(toCanonicalHostUrl("http://twitter.com/jack/status/20")).toBe("http://x.com/jack/status/20");
	});

	it("returns an x.com URL unchanged", () => {
		const url = "https://x.com/jack/status/20?s=20#reply";
		expect(toCanonicalHostUrl(url)).toBe(url);
	});

	it("keeps every query value and the fragment", () => {
		expect(toCanonicalHostUrl("https://twitter.com/jack/status/20/photo/1?s=46&t=AbC-9_x&lang=en#m")).toBe(
			"https://x.com/jack/status/20/photo/1?s=46&t=AbC-9_x&lang=en#m",
		);
	});

	it("keeps a trailing slash and an empty query marker as they are", () => {
		expect(toCanonicalHostUrl("https://twitter.com/jack/?")).toBe("https://x.com/jack/?");
	});

	it("rewrites a host spelled in capitals", () => {
		expect(toCanonicalHostUrl("https://TWITTER.COM/jack")).toBe("https://x.com/jack");
	});

	it("rewrites a URL that spells out its scheme's default port", () => {
		expect(toCanonicalHostUrl("https://twitter.com:443/jack")).toBe("https://x.com/jack");
		expect(toCanonicalHostUrl("http://twitter.com:80/jack")).toBe("http://x.com/jack");
	});

	it("gives a Unicode path the same article identity whichever host it was saved on", () => {
		const canonical = toCanonicalHostUrl("https://twitter.com/ユーザー/status/1?q=é");

		expect(canonical).toBe("https://x.com/%E3%83%A6%E3%83%BC%E3%82%B6%E3%83%BC/status/1?q=%C3%A9");
		expect(ArticleResourceUniqueId.parse(canonical).value).toBe(
			ArticleResourceUniqueId.parse("https://x.com/ユーザー/status/1?q=é").value,
		);
	});

	it("rewrites a URL far longer than any saveable one without truncating it", () => {
		const path = `/jack/status/20/${"a".repeat(10_000)}`;

		expect(toCanonicalHostUrl(`https://twitter.com${path}`)).toBe(`https://x.com${path}`);
	});

	it.each([
		["a non-default port", "https://twitter.com:8443/jack"],
		["the other scheme's default port", "http://twitter.com:443/jack"],
		["a username", "https://jack@twitter.com/jack"],
		["a username and password", "https://jack:secret@twitter.com/jack"],
		["a non-http scheme", "ftp://twitter.com/jack"],
		["a websocket scheme", "wss://twitter.com/jack"],
		["no scheme", "twitter.com/jack"],
		["unparseable text", "not a url"],
		["an empty string", ""],
	])("leaves a URL with %s unchanged", (_label, url) => {
		expect(toCanonicalHostUrl(url)).toBe(url);
	});

	it.each([
		["mobile.twitter.com", "https://mobile.twitter.com/jack/status/20"],
		["www.twitter.com", "https://www.twitter.com/jack/status/20"],
		["www.x.com", "https://www.x.com/jack/status/20"],
		["a trailing-dot host", "https://twitter.com./jack/status/20"],
		["a host that only starts with twitter.com", "https://twitter.com.example.org/jack"],
		["a host that only ends with twitter.com", "https://eviltwitter.com/jack"],
		["a host that only ends with x.com", "https://box.com/jack"],
		["a different top-level domain", "https://twitter.co/jack"],
		["a homograph of twitter.com", "https://twіtter.com/jack"],
		["twitter.com as the userinfo of another host", "https://twitter.com@example.org/jack"],
		["twitter.com inside the path", "https://example.org/twitter.com/jack"],
		["twitter.com inside the query", "https://example.org/?u=https://twitter.com/jack"],
	])("leaves %s unchanged", (_label, url) => {
		expect(toCanonicalHostUrl(url)).toBe(url);
	});

	it.each([
		"https://twitter.com/jack/status/20?s=20#top",
		"http://TWITTER.com:80/ユーザー",
		"https://x.com/jack",
		"https://mobile.twitter.com/jack",
		"not a url",
	])("is idempotent for %s", (url) => {
		const once = toCanonicalHostUrl(url);
		expect(toCanonicalHostUrl(once)).toBe(once);
	});

	it("leaves ArticleResourceUniqueId's own key for a twitter.com URL as it was", () => {
		const id = ArticleResourceUniqueId.parse("https://twitter.com/jack/status/20");

		expect(id.value).toBe("twitter.com/jack/status/20");
		expect(id.toS3ContentKey()).toBe("content/twitter.com%2Fjack%2Fstatus%2F20/content.html");
	});
});

describe("equivalentHostUrls", () => {
	it("lists the x.com spelling first, then twitter.com, for a twitter.com URL", () => {
		expect(equivalentHostUrls("https://twitter.com/jack/status/20?s=20#top")).toEqual([
			"https://x.com/jack/status/20?s=20#top",
			"https://twitter.com/jack/status/20?s=20#top",
		]);
	});

	it("lists the same order for an x.com URL", () => {
		expect(equivalentHostUrls("http://x.com/jack")).toEqual(["http://x.com/jack", "http://twitter.com/jack"]);
	});

	it("keeps the caller's own spelling as its own host's entry", () => {
		expect(equivalentHostUrls("https://TWITTER.com/jack")).toEqual([
			"https://x.com/jack",
			"https://TWITTER.com/jack",
		]);
	});

	it.each([
		"https://example.org/jack",
		"https://mobile.twitter.com/jack",
		"https://twitter.com:8443/jack",
		"https://jack@x.com/jack",
		"not a url",
	])("lists only the URL itself for %s", (url) => {
		expect(equivalentHostUrls(url)).toEqual([url]);
	});
});
