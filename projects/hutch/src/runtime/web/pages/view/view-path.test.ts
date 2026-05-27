import { parseViewPath, viewPathFor } from "./view-path";

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
});
