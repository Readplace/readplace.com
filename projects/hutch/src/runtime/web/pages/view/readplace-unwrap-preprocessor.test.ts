import { readplaceUnwrapPreprocessor } from "./readplace-unwrap-preprocessor";

const SELF_HOST = "readplace.com";

function unwrap(selfHost: string): (rawUrl: string) => string {
	return (rawUrl) => readplaceUnwrapPreprocessor(rawUrl, { selfHost });
}

const preparse = unwrap(SELF_HOST);

describe("readplaceUnwrapPreprocessor — self-URL unwrapping", () => {
	it("unwraps a /view/<host>/<path> self-URL to the original article", () => {
		expect(preparse("https://readplace.com/view/fagnerbrack.com/business-success")).toBe(
			"https://fagnerbrack.com/business-success",
		);
	});

	it("recursively collapses a nested self-URL", () => {
		expect(
			preparse("https://readplace.com/view/readplace.com/view/fagnerbrack.com/x"),
		).toBe("https://fagnerbrack.com/x");
	});

	it("fully unwraps nesting far deeper than any real link", () => {
		const nested = `https://readplace.com/view/${"readplace.com/view/".repeat(40)}fagnerbrack.com/x`;
		expect(preparse(nested)).toBe("https://fagnerbrack.com/x");
	});

	it("collapses an explicit https:// scheme nested in the /view path", () => {
		expect(preparse("https://readplace.com/view/https://fagnerbrack.com/x")).toBe(
			"https://fagnerbrack.com/x",
		);
	});

	it("decodes the article's own query separator (%3F) back into the original URL", () => {
		expect(preparse("https://readplace.com/view/example.com/post%3Ffoo=bar")).toBe(
			"https://example.com/post?foo=bar",
		);
	});

	it("decodes the article's fragment separator (%23) back into the original URL", () => {
		expect(preparse("https://readplace.com/view/example.com/post%23section")).toBe(
			"https://example.com/post#section",
		);
	});

	it("preserves a literal percent (%2525 -> %25) in the original URL", () => {
		expect(preparse("https://readplace.com/view/example.com/path%2525foo")).toBe(
			"https://example.com/path%25foo",
		);
	});

	it("preserves an explicit http:// article scheme", () => {
		expect(preparse("https://readplace.com/view/http://example.com/x")).toBe(
			"http://example.com/x",
		);
	});

	it("drops Readplace's own share-tracking query while keeping the original article", () => {
		expect(
			preparse(
				"https://readplace.com/view/fagnerbrack.com/x?utm_source=read&utm_medium=share&utm_content=abc",
			),
		).toBe("https://fagnerbrack.com/x");
	});

	it("reads the article from the ?url= param on the /view/ landing path", () => {
		expect(
			preparse(`https://readplace.com/view/?url=${encodeURIComponent("https://example.com/a")}`),
		).toBe("https://example.com/a");
	});

	it("reads the article from the ?url= param on the /view landing path", () => {
		expect(
			preparse(`https://readplace.com/view?url=${encodeURIComponent("https://example.com/a")}`),
		).toBe("https://example.com/a");
	});

	it("unwraps a self-URL nested inside the ?url= param", () => {
		const inner = encodeURIComponent("https://readplace.com/view/fagnerbrack.com/x");
		expect(preparse(`https://readplace.com/view?url=${inner}`)).toBe("https://fagnerbrack.com/x");
	});

	it("unwraps a self-host written with a trailing FQDN dot", () => {
		expect(preparse("https://readplace.com./view/fagnerbrack.com/x")).toBe(
			"https://fagnerbrack.com/x",
		);
	});

	it("leaves the bare /view landing path (no url param) unchanged", () => {
		expect(preparse("https://readplace.com/view")).toBe("https://readplace.com/view");
	});

	it("leaves a non-article self path unchanged (blog)", () => {
		expect(preparse("https://readplace.com/blog/pocket-migration")).toBe(
			"https://readplace.com/blog/pocket-migration",
		);
	});

	it("leaves the queue self path unchanged", () => {
		expect(preparse("https://readplace.com/queue")).toBe("https://readplace.com/queue");
	});

	/** Documents the current limit: the `/queue/:id/view` permalink (the link every
	 * queue card emits) carries only an opaque hash id, so this synchronous
	 * preprocessor cannot resolve it and leaves it untouched. Unwrapping it needs an
	 * async store lookup, added later as a separate preprocessor. */
	it("leaves a /queue/:id/view permalink unchanged (opaque hash id, needs async lookup)", () => {
		const permalink = "https://readplace.com/queue/9909df2208c6e55dfb5801ed39305052/view";
		expect(preparse(permalink)).toBe(permalink);
	});

	it("leaves the self homepage unchanged", () => {
		expect(preparse("https://readplace.com/")).toBe("https://readplace.com/");
	});

	it("leaves a /view URL on another host unchanged (not a wrapper)", () => {
		expect(preparse("https://example.com/view/foo.com/x")).toBe("https://example.com/view/foo.com/x");
	});

	it("leaves a malformed URL unchanged", () => {
		expect(preparse("not a url")).toBe("not a url");
	});

	it("leaves a /view path with an undecodable lone % unchanged", () => {
		expect(preparse("https://readplace.com/view/example.com/path%foo")).toBe(
			"https://readplace.com/view/example.com/path%foo",
		);
	});

	describe("self-host is matched including port", () => {
		const portPreparse = unwrap("localhost:3000");

		it("unwraps when the host and port match", () => {
			expect(portPreparse("https://localhost:3000/view/example.com/x")).toBe(
				"https://example.com/x",
			);
		});

		it("leaves a different port unchanged", () => {
			expect(portPreparse("https://localhost:4000/view/example.com/x")).toBe(
				"https://localhost:4000/view/example.com/x",
			);
		});
	});
});
