import {
	isArchiveHost,
	stripRedirectAddedParams,
	unwrapWrapperUrl,
	wrapperFamilyOf,
	wrapperResolutionOf,
} from "./wrapper-url";

const TRACKERS = [
	"https://leadershipintech.com/links/5134/0b1f0d9c-3b6e-4f9d-9a1e-6f0d5c8e2a11/email",
	"https://csharpdigest.net/links/9/0B1F0D9C-3B6E-4F9D-9A1E-6F0D5C8E2A11",
	"https://javascriptweekly.com/link/100000/rss",
	"https://us.list-manage.com/track/click?u=abc&id=def&e=sub",
	"https://us12.list-manage.com/track/click?u=abc&id=def&e=sub",
	"https://us.list-manage.com/z5nMJesu3W3?c2id=5f57c6b558b0fa2f2e9be286033610a1&e=ab645c7bcd",
	"https://newsletter.weeklyfilet.com/r/0f9a8b7c6d",
	"https://open.substack.com/pub/lcamtuf/p/the-sad-state-of-property-graph-query",
	"https://substack.com/redirect/0b1f0d9c-3b6e-4f9d-9a1e-6f0d5c8e2a11",
	"https://share.google/AbCdEf_12-3",
	"https://www.google.com/share.google?q=https%3A%2F%2Fpublisher.example%2Farticle",
];

const NEAR_MISSES = [
	"https://leadershipintech.com/issues/412",
	"https://leadershipintech.com/links/5134/not-a-uuid/email",
	"https://javascriptweekly.com/issues/700",
	"https://us.list-manage.com/subscribe?u=abc&id=def",
	"https://us.list-manage.com/z5nMJesu3W3",
	"https://us.list-manage.com/z5nMJesu3W3?e=ab645c7bcd",
	"https://newsletter.weeklyfilet.com/issues/2026-09",
	"https://open.substack.com/pub/lcamtuf",
	"https://lcamtuf.substack.com/p/the-sad-state-of-property-graph-query",
	"https://substack.com/home",
	"https://share.google/",
	"https://www.google.com/share.google",
	"https://www.google.com/search?q=share.google",
	"https://apple.news/",
	"https://apple.news/AjYm3jdR0S4uhs9hRKpJ1Sg/related",
	"https://web.archive.org/web/*/https://publisher.example/*",
	"https://archive.ph/",
	"https://web.archive.org/web/20260707152150im_/https://www.tampabay.com/a.jpg?auth=abc",
	"https://web.archive.org/web/20260707152150cs_/https://publisher.example/style.css",
	"https://web.archive.org/web/timemap/link/https://publisher.example/article",
	"https://web.archive.org/web/",
	"https://web.archive.org/web/2018/ftp://files.example/a",
	"https://web.archive.org/web/20260000000000*/https%3A%2F%E0%A4%A",
	"https://archive.org/details/bstj57-6-1899",
	"https://blog.archive.org/2026/01/01/a-post/",
	"https://archive.ph/newest",
	"https://archive.ph/wip",
	"https://archive.ph/timegate/https://publisher.example/article",
	"https://publisher.example/article",
];

const WAYBACK = "https://web.archive.org/web/20081203185222/http://www.onscreenasia.com/article-106.html";
const ORIGINAL = "http://www.onscreenasia.com/article-106.html";

describe("wrapperFamilyOf", () => {
	it.each(TRACKERS)("classifies %s as a newsletter tracker", (url) => {
		expect(wrapperFamilyOf(url)).toBe("newsletter-tracker");
	});

	it.each([
		"https://apple.news/AjYm3jdR0S4uhs9hRKpJ1Sg",
		"https://www.apple.news/AjYm3jdR0S4uhs9hRKpJ1Sg",
		"https://apple.news/AjYm3jdR0S4uhs9hRKpJ1Sg?articleList=x&campaign_id=y",
	])("classifies %s as an Apple News story", (url) => {
		expect(wrapperFamilyOf(url)).toBe("apple-news");
	});

	it.each([
		WAYBACK,
		"https://web.archive.org/web/2018/https://publisher.example/article",
		"https://archive.ph/Ab1cD",
		"https://archive.is/Ab1cD",
		"https://archive.today/Ab1cD",
		"https://archive.ph/20240102123456/https://publisher.example/article",
		"https://archive.ph/2024.01.02-123456/https://publisher.example/article",
		"https://archive.ph/Ab1cD/0123456789abcdef0123456789abcdef01234567/scr.png",
	])("classifies %s as an archive snapshot", (url) => {
		expect(wrapperFamilyOf(url)).toBe("archive-snapshot");
	});

	it.each(NEAR_MISSES)("leaves %s unclassified", (url) => {
		expect(wrapperFamilyOf(url)).toBeUndefined();
	});

	it("matches a fully-qualified hostname written with a trailing dot", () => {
		expect(wrapperFamilyOf("https://javascriptweekly.com./link/100000/rss")).toBe("newsletter-tracker");
	});

	it.each(["not a url", "ftp://javascriptweekly.com/link/100000/rss", "mailto:someone@example.com"])(
		"leaves the non-HTTP input %s unclassified",
		(url) => {
			expect(wrapperFamilyOf(url)).toBeUndefined();
		},
	);
});

describe("isArchiveHost", () => {
	it.each(["https://web.archive.org/web/2018/https://x.example/", "https://archive.ph/Ab1cD", "https://archive.is/", "https://archive.today/"])(
		"recognises %s",
		(url) => {
			expect(isArchiveHost(url)).toBe(true);
		},
	);

	it.each(["https://publisher.example/article", "https://archive.org/details/item", "not a url"])(
		"does not recognise %s",
		(url) => {
			expect(isArchiveHost(url)).toBe(false);
		},
	);
});

describe("unwrapWrapperUrl", () => {
	it("recovers the original from a Wayback capture and keeps the snapshot as the content source", () => {
		expect(unwrapWrapperUrl(WAYBACK)).toEqual({ url: ORIGINAL, contentSourceUrl: WAYBACK });
	});

	it.each([
		{
			label: "an id_ (raw) capture",
			snapshot: "https://web.archive.org/web/20260707152150id_/https://publisher.example/article",
			original: "https://publisher.example/article",
		},
		{
			label: "a capture whose embedded scheme was collapsed to a single slash",
			snapshot: "https://web.archive.org/web/20260707152150/https:/publisher.example/article",
			original: "https://publisher.example/article",
		},
		{
			label: "a capture carrying the original's query and fragment",
			snapshot: "https://web.archive.org/web/2018/https://publisher.example/article?id=7#section",
			original: "https://publisher.example/article?id=7#section",
		},
		{
			label: "an archive.today capture with a compact timestamp",
			snapshot: "https://archive.ph/20240102123456/https://publisher.example/article",
			original: "https://publisher.example/article",
		},
		{
			label: "an archive.today capture with a dotted timestamp",
			snapshot: "https://archive.is/2024.01.02-123456/https://publisher.example/article?x=1",
			original: "https://publisher.example/article?x=1",
		},
	])("recovers the original from $label", ({ snapshot, original }) => {
		expect(unwrapWrapperUrl(snapshot)).toEqual({ url: original, contentSourceUrl: snapshot });
	});

	it("collapses an archive.today screenshot URL onto its snapshot id, which is still not an original", () => {
		expect(
			unwrapWrapperUrl("https://archive.ph/Ab1cD/0123456789abcdef0123456789abcdef01234567/scr.png"),
		).toEqual({ url: "https://archive.ph/Ab1cD" });
	});

	it.each([
		"https://twitter.com/intent/tweet?url=https%3A%2F%2Fpublisher.example%2Farticle&text=Read",
		"https://x.com/intent/post?url=https%3A%2F%2Fpublisher.example%2Farticle",
	])("recovers the shared URL from the tweet intent %s", (intent) => {
		expect(unwrapWrapperUrl(intent)).toEqual({ url: "https://publisher.example/article" });
	});

	it.each([
		{ label: "a tweet intent without a url", url: "https://twitter.com/intent/tweet?text=Read" },
		{ label: "a tweet intent sharing a non-HTTP URL", url: "https://x.com/intent/post?url=javascript%3Aalert(1)" },
		{ label: "a Wayback capture of a non-HTTP original", url: "https://web.archive.org/web/2018/ftp://files.example/a" },
		{ label: "an archive.today short id", url: "https://archive.ph/Ab1cD" },
		{ label: "a Wayback calendar wildcard", url: "https://web.archive.org/web/*/https://publisher.example/*" },
		{ label: "an im_ (image) capture", url: "https://web.archive.org/web/20260707152150im_/https://www.tampabay.com/a.jpg?auth=abc" },
		{ label: "a newsletter tracker (needs the network)", url: "https://javascriptweekly.com/link/100000/rss" },
		{ label: "a plain article", url: "https://publisher.example/article" },
		{ label: "a non-HTTP URL", url: "mailto:someone@example.com" },
		{ label: "an unparsable string", url: "not a url" },
	])("leaves $label untouched", ({ url }) => {
		expect(unwrapWrapperUrl(url)).toEqual({ url });
	});
});

describe("stripRedirectAddedParams", () => {
	const target =
		"https://blog.example/p/post?r=abc12&publication_id=1&post_id=2&isFreemail=true&triedRedirect=true&utm_source=substack&page=2";

	it.each(["https://open.substack.com/pub/lcamtuf/p/post", "https://substack.com/redirect/0b1f0d9c"])(
		"removes the per-subscriber Substack params a %s redirect appends, keeping every other param",
		(wrapperUrl) => {
			expect(stripRedirectAddedParams({ wrapperUrl, targetUrl: target })).toBe(
				"https://blog.example/p/post?utm_source=substack&page=2",
			);
		},
	);

	it("drops the query entirely when only Substack params were present", () => {
		expect(
			stripRedirectAddedParams({
				wrapperUrl: "https://open.substack.com/pub/lcamtuf/p/post",
				targetUrl: "https://blog.example/p/post?r=abc12",
			}),
		).toBe("https://blog.example/p/post");
	});

	it("leaves a non-Substack wrapper's target untouched, even when it carries the same param names", () => {
		expect(
			stripRedirectAddedParams({ wrapperUrl: "https://javascriptweekly.com/link/100000/rss", targetUrl: target }),
		).toBe(target);
	});

	it("leaves the target untouched when the wrapper is not an HTTP URL", () => {
		expect(stripRedirectAddedParams({ wrapperUrl: "not a url", targetUrl: target })).toBe(target);
	});

	it("leaves an unparsable target untouched", () => {
		expect(
			stripRedirectAddedParams({ wrapperUrl: "https://open.substack.com/pub/lcamtuf/p/post", targetUrl: "not a url" }),
		).toBe("not a url");
	});
});

describe("archive URL shapes", () => {
	const ARTICLE = "https://mamund.substack.com/p/the-hypermedia-commons-we-missed";
	const LATEST_WAYBACK_CAPTURE = `https://web.archive.org/web/${ARTICLE}`;

	it.each([
		{ label: "the calendar the Wayback UI leaves in the address bar", url: `https://web.archive.org/web/20260000000000*/${ARTICLE}` },
		{ label: "a bare calendar", url: `https://web.archive.org/web/*/${ARTICLE}` },
		{ label: "a year calendar", url: `https://web.archive.org/web/2026*/${ARTICLE}` },
		{ label: "a percent-encoded calendar star", url: `https://web.archive.org/web/20260000000000%2A/${ARTICLE}` },
		{ label: "a lowercase percent-encoded bare star", url: `https://web.archive.org/web/%2a/${ARTICLE}` },
		{ label: "a calendar behind an http outer URL", url: `http://web.archive.org/web/*/${ARTICLE}` },
		{ label: "the timestamp-less timegate", url: `https://web.archive.org/web/${ARTICLE}` },
		{ label: "a Save Page Now URL", url: `https://web.archive.org/save/${ARTICLE}` },
	])("keys $label on the article and reads the latest capture", ({ url }) => {
		expect(wrapperFamilyOf(url)).toBe("archive-snapshot");
		expect(unwrapWrapperUrl(url)).toEqual({ url: ARTICLE, contentSourceUrl: LATEST_WAYBACK_CAPTURE });
		expect(wrapperResolutionOf(url)).toBe("syntactic");
	});

	it.each([
		{ label: "a scheme-less inner URL", inner: "mamund.substack.com/p/the-hypermedia-commons-we-missed" },
		{ label: "a percent-encoded inner URL", inner: "https%3A%2F%2Fmamund.substack.com%2Fp%2Fthe-hypermedia-commons-we-missed" },
	])("recovers the article from a Wayback capture with $label", ({ inner }) => {
		const snapshot = `https://web.archive.org/web/20250925144454/${inner}`;
		expect(unwrapWrapperUrl(snapshot)).toEqual({ url: ARTICLE, contentSourceUrl: snapshot });
	});

	it.each(["https://wayback.archive.org", "https://www.web.archive.org", "http://web.archive.org"])(
		"reads a capture on %s from web.archive.org over https",
		(origin) => {
			expect(unwrapWrapperUrl(`${origin}/web/20250925144454/${ARTICLE}`)).toEqual({
				url: ARTICLE,
				contentSourceUrl: `https://web.archive.org/web/20250925144454/${ARTICLE}`,
			});
		},
	);

	it.each(["archive.ph", "archive.is", "archive.today", "archive.md", "archive.li", "archive.fo", "archive.vn"])(
		"treats every archive.today mirror (%s) as an archive host with captures and short ids",
		(host) => {
			const capture = `https://${host}/20261002094222/${ARTICLE}`;
			expect(isArchiveHost(`https://${host}/Ab1cD`)).toBe(true);
			expect(wrapperFamilyOf(`https://${host}/Ab1cD`)).toBe("archive-snapshot");
			expect(wrapperResolutionOf(`https://${host}/Ab1cD`)).toBe("network");
			expect(unwrapWrapperUrl(capture)).toEqual({ url: ARTICLE, contentSourceUrl: capture });
		},
	);

	it.each(["https://wayback.archive.org/web/2018/https://x.example/", "https://www.web.archive.org/"])(
		"recognises the alternate Wayback host %s as an archive host",
		(url) => {
			expect(isArchiveHost(url)).toBe(true);
		},
	);

	it.each([
		{ label: "newest capture", url: `https://archive.ph/newest/${ARTICLE}`, contentSourceUrl: `https://archive.ph/newest/${ARTICLE}` },
		{ label: "oldest capture", url: `https://archive.ph/oldest/${ARTICLE}`, contentSourceUrl: `https://archive.ph/oldest/${ARTICLE}` },
		{ label: "partial-timestamp capture", url: `https://archive.ph/2026/${ARTICLE}`, contentSourceUrl: `https://archive.ph/newest/${ARTICLE}` },
		{ label: "listing of every capture", url: `https://archive.li/${ARTICLE}`, contentSourceUrl: `https://archive.li/newest/${ARTICLE}` },
		{ label: "outbound link from a capture", url: `https://archive.ph/o/Ab1cD/${ARTICLE}`, contentSourceUrl: "https://archive.ph/Ab1cD" },
	])("keys an archive.today $label on the article", ({ url, contentSourceUrl }) => {
		expect(wrapperFamilyOf(url)).toBe("archive-snapshot");
		expect(unwrapWrapperUrl(url)).toEqual({ url: ARTICLE, contentSourceUrl });
	});

	it("collapses an archive.today work-in-progress URL onto its short id, which still needs the network", () => {
		expect(unwrapWrapperUrl("https://archive.ph/wip/Ab1cD")).toEqual({ url: "https://archive.ph/Ab1cD" });
		expect(wrapperResolutionOf("https://archive.ph/wip/Ab1cD")).toBe("network");
	});

	it.each([
		{ label: "a plain article", url: ARTICLE, resolution: "none" },
		{ label: "a tweet intent", url: `https://x.com/intent/post?url=${encodeURIComponent(ARTICLE)}`, resolution: "none" },
		{ label: "a newsletter tracker", url: "https://javascriptweekly.com/link/100000/rss", resolution: "network" },
		{ label: "a Wayback capture of a tracker", url: "https://web.archive.org/web/2026/https://javascriptweekly.com/link/100000/rss", resolution: "network" },
	])("resolves $label by $resolution", ({ url, resolution }) => {
		expect(wrapperResolutionOf(url)).toBe(resolution);
	});
});
