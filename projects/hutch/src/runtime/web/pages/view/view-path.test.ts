import {
	canonicalizeViewLandingPath,
	originalUrlFromViewPath,
	parseViewPath,
	viewPathFor,
} from "./view-path";

function parse(decodedAndEncoded: string): ReturnType<typeof parseViewPath>;
function parse(args: { rawPath: string; encodedPath: string }): ReturnType<typeof parseViewPath>;
function parse(args: string | { rawPath: string; encodedPath: string }): ReturnType<typeof parseViewPath> {
	if (typeof args === "string") return parseViewPath({ rawPath: args, encodedPath: args });
	return parseViewPath(args);
}

describe("viewPathFor", () => {
	it("strips the https:// scheme and keeps slashes unencoded", () => {
		expect(viewPathFor("https://example.com/post")).toBe("/view/example.com/post");
	});

	it("preserves tildes and other unreserved path characters", () => {
		expect(
			viewPathFor(
				"https://web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf",
			),
		).toBe(
			"/view/web.eecs.umich.edu/~weimerw/2018-481/readings/mythical-man-month.pdf",
		);
	});

	it("retains the explicit http:// scheme so http articles are unambiguous", () => {
		expect(viewPathFor("http://example.com/post")).toBe("/view/http://example.com/post");
	});

	it("keeps non-default ports on the host segment", () => {
		expect(viewPathFor("https://example.com:8080/post")).toBe(
			"/view/example.com:8080/post",
		);
	});

	it("percent-encodes the article URL's query separator so Express keeps it in the path", () => {
		expect(viewPathFor("https://example.com/post?foo=bar")).toBe(
			"/view/example.com/post%3Ffoo=bar",
		);
	});

	it("percent-encodes the article URL's fragment separator", () => {
		expect(viewPathFor("https://example.com/post#section")).toBe(
			"/view/example.com/post%23section",
		);
	});

	it("renders an empty pathname as a single trailing slash from the URL constructor", () => {
		expect(viewPathFor("https://example.com")).toBe("/view/example.com/");
	});

	it("double-encodes literal percent signs (%25) so they survive Express decode", () => {
		expect(viewPathFor("https://example.com/path%25foo")).toBe(
			"/view/example.com/path%2525foo",
		);
	});

	it("double-encodes %25 followed by two hex digits (previously lossy)", () => {
		expect(viewPathFor("https://example.com/path%25C3")).toBe(
			"/view/example.com/path%2525C3",
		);
	});

	it("leaves regular percent-encoded bytes untouched (only %25 is double-encoded)", () => {
		expect(viewPathFor("https://example.com/path%C3%A9")).toBe(
			"/view/example.com/path%C3%A9",
		);
	});
});

describe("canonicalizeViewLandingPath", () => {
	it("collapses a /view/https:/ landing path to the scheme-less canonical", () => {
		expect(canonicalizeViewLandingPath("/view/https:/fagnerbrack.com/learn-sql")).toBe(
			"/view/fagnerbrack.com/learn-sql",
		);
	});

	it("collapses a /view/https:// landing path to the scheme-less canonical", () => {
		expect(canonicalizeViewLandingPath("/view/https://fagnerbrack.com/learn-sql")).toBe(
			"/view/fagnerbrack.com/learn-sql",
		);
	});

	it("keeps the explicit http:// scheme for a /view/http:/ landing path", () => {
		expect(canonicalizeViewLandingPath("/view/http:/example.com/post")).toBe(
			"/view/http://example.com/post",
		);
	});

	it("leaves an already-canonical /view path unchanged", () => {
		expect(canonicalizeViewLandingPath("/view/fagnerbrack.com/learn-sql")).toBe(
			"/view/fagnerbrack.com/learn-sql",
		);
	});

	it("leaves a non-/view path unchanged", () => {
		expect(canonicalizeViewLandingPath("/queue")).toBe("/queue");
	});

	it("leaves the root path unchanged", () => {
		expect(canonicalizeViewLandingPath("/")).toBe("/");
	});

	it("re-encodes a literal %25 to %2525 so the landing path is byte-identical to the 301 target", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/path%25foo");
		expect(landing).toBe("/view/example.com/path%2525foo");
		expect(landing).toBe(viewPathFor("https://example.com/path%25foo"));
	});

	it("re-encodes the article URL's ? separator into the path, matching the 301 target", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/post%3Ffoo=bar");
		expect(landing).toBe("/view/example.com/post%3Ffoo=bar");
		expect(landing).toBe(viewPathFor("https://example.com/post?foo=bar"));
	});

	it("preserves already percent-encoded UTF-8 bytes so non-ASCII article paths are not corrupted", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/path%C3%A9");
		expect(landing).toBe("/view/example.com/path%C3%A9");
		expect(landing).toBe(viewPathFor("https://example.com/path%C3%A9"));
	});

	it("re-encodes an unsafe byte (space) the way the browser's post-301 request encodes it", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/a%20b");
		expect(landing).toBe("/view/example.com/a%20b");
		expect(landing).toBe(viewPathFor("https://example.com/a b"));
	});

	it("keeps [ ] and | literal — the browser's post-301 request leaves them unencoded, so percent-encoding them would break the landing_path ↔ pageview join", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/a[b]|c");
		expect(landing).toBe("/view/example.com/a[b]|c");
		expect(landing).toBe(viewPathFor("https://example.com/a[b]|c"));
	});

	it("re-encodes ^ the way the browser re-parses the 301 Location, even though the Location header itself carries it literally", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/a^b");
		expect(landing).toBe("/view/example.com/a%5Eb");
		expect(landing).toBe(viewPathFor("https://example.com/a^b"));
	});

	it("folds a backslash to / the way the browser re-parses the 301 Location", () => {
		const landing = canonicalizeViewLandingPath("/view/https://example.com/a\\b");
		expect(landing).toBe("/view/example.com/a/b");
		expect(landing).toBe(viewPathFor("https://example.com/a\\b"));
	});

	it("leaves a literal http:// landing path unchanged — the router renders it, so it equals its own no-redirect pageview", () => {
		expect(canonicalizeViewLandingPath("/view/http://example.com/post")).toBe(
			"/view/http://example.com/post",
		);
	});

	it("leaves a landing path with an undecodable percent sequence unchanged", () => {
		expect(canonicalizeViewLandingPath("/view/https://example.com/%zz")).toBe(
			"/view/https://example.com/%zz",
		);
	});
});

describe("parseViewPath", () => {
	it("treats a plain host/path as an https article", () => {
		expect(parse("example.com/post")).toEqual({
			kind: "render",
			articleUrl: "https://example.com/post",
		});
	});

	it("renders the literal http:// canonical without redirecting", () => {
		expect(parse("http://example.com/post")).toEqual({
			kind: "render",
			articleUrl: "http://example.com/post",
		});
	});

	it("redirects an old https:// path to the scheme-less canonical", () => {
		expect(parse("https://example.com/post")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/example.com/post",
		});
	});

	it("redirects a collapsed https:/ path to the canonical", () => {
		expect(parse("https:/example.com/post")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/example.com/post",
		});
	});

	it("redirects a collapsed http:/ path to the http:// canonical", () => {
		expect(parse("http:/example.com/post")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/http://example.com/post",
		});
	});

	it("preserves the article URL's query when re-encoded into the path", () => {
		expect(parse("example.com/post?foo=bar")).toEqual({
			kind: "render",
			articleUrl: "https://example.com/post?foo=bar",
		});
	});

	it("redirects old https://...?foo=bar format to canonical, re-encoding the ? into the path", () => {
		expect(parse("https://example.com/post?foo=bar")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/example.com/post%3Ffoo=bar",
		});
	});

	it("redirects old https://...#frag format to canonical, re-encoding the # into the path", () => {
		expect(parse("https://example.com/post#frag")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/example.com/post%23frag",
		});
	});

	it("redirects old http:/...?foo=bar to a canonical that keeps http:// and encodes the article ?", () => {
		expect(parse("http:/example.com/post?foo=bar")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/http://example.com/post%3Ffoo=bar",
		});
	});

	it("redirects encoded http%3A%2F%2F (legacy) to the http:// canonical", () => {
		expect(
			parseViewPath({
				rawPath: "http://example.com/post",
				encodedPath: "http%3A%2F%2Fexample.com%2Fpost",
			}),
		).toEqual({
			kind: "redirect",
			canonicalPath: "/view/http://example.com/post",
		});
	});

	it("renders the canonical http:// when the original URL has the literal `://`", () => {
		expect(
			parseViewPath({
				rawPath: "http://example.com/post",
				encodedPath: "http://example.com/post",
			}),
		).toEqual({ kind: "render", articleUrl: "http://example.com/post" });
	});

	it("re-encodes bare % from Express-decoded paths so the article URL stays valid", () => {
		expect(parse("example.com/path%foo")).toEqual({
			kind: "render",
			articleUrl: "https://example.com/path%25foo",
		});
	});

	it("redirects https:// paths with bare % and double-encodes the re-encoded %25 in the redirect target", () => {
		expect(parse("https://example.com/path%foo")).toEqual({
			kind: "redirect",
			canonicalPath: "/view/example.com/path%2525foo",
		});
	});

	it("is round-trip stable: parseViewPath(viewPathFor(url).slice('/view/'.length)) renders the same url", () => {
		const url = "https://web.eecs.umich.edu/~weimerw/path";
		const path = viewPathFor(url);
		const rawWildcard = path.slice("/view/".length);
		expect(parse(rawWildcard)).toEqual({ kind: "render", articleUrl: url });
	});

	it("is round-trip stable for http URLs when the original URL kept the literal ://", () => {
		const url = "http://example.com/post";
		const path = viewPathFor(url);
		const rawWildcard = path.slice("/view/".length);
		expect(parse(rawWildcard)).toEqual({ kind: "render", articleUrl: url });
	});

	it("is round-trip stable for percent-encoded article URLs through Express decode", () => {
		const url = "https://example.com/path%25foo";
		const path = viewPathFor(url);
		const rawWildcard = decodeURIComponent(path.slice("/view/".length));
		expect(parse(rawWildcard)).toEqual({ kind: "render", articleUrl: url });
	});

	it("is round-trip stable for %25 followed by two hex digits through Express decode", () => {
		const url = "https://example.com/path%25C3";
		const path = viewPathFor(url);
		const rawWildcard = decodeURIComponent(path.slice("/view/".length));
		expect(parse(rawWildcard)).toEqual({ kind: "render", articleUrl: url });
	});
});

describe("originalUrlFromViewPath", () => {
	it("recovers the https article URL from a scheme-less tail", () => {
		expect(originalUrlFromViewPath("example.com/post")).toBe("https://example.com/post");
	});

	it("decodes the percent-encoded query separator back into the article URL", () => {
		expect(originalUrlFromViewPath("example.com/post%3Ffoo=bar")).toBe(
			"https://example.com/post?foo=bar",
		);
	});

	it("preserves an explicit http:// scheme", () => {
		expect(originalUrlFromViewPath("http://example.com/post")).toBe("http://example.com/post");
	});

	it("resolves a redirect tail (legacy https:// prefix) to the canonical article URL", () => {
		expect(originalUrlFromViewPath("https://example.com/post")).toBe("https://example.com/post");
	});

	it("resolves a collapsed http:/ redirect tail to the http article URL", () => {
		expect(originalUrlFromViewPath("http:/example.com/post")).toBe("http://example.com/post");
	});

	it("returns undefined when the tail cannot be percent-decoded", () => {
		expect(originalUrlFromViewPath("example.com/path%foo")).toBeUndefined();
	});

	it("resolves a deeply scheme-stacked tail instead of capping out", () => {
		const nested = `${"https://".repeat(40)}example.com/x`;
		expect(originalUrlFromViewPath(nested)).toBe("https://example.com/x");
	});
});
