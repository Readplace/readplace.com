import { extractUrls } from "./extract-urls";

describe("extractUrls", () => {
	it("extracts http and https URLs from plain text", () => {
		const buf = Buffer.from(
			"Check out https://example.com/post and http://example.org/article today.",
		);

		const result = extractUrls(buf);

		expect(result.urls).toEqual([
			"https://example.com/post",
			"http://example.org/article",
		]);
		expect(result.truncated).toBe(false);
	});

	it("falls back to latin-1 when utf-8 contains the replacement character", () => {
		// 0xa3 (£) is invalid UTF-8 but a valid Latin-1 byte. The URL itself is ASCII.
		const buf = Buffer.from([
			...Buffer.from("Cost \xa3 https://example.com/article today", "latin1"),
		]);

		const result = extractUrls(buf);

		expect(result.urls).toEqual(["https://example.com/article"]);
	});

	it("extracts URLs from a Pocket-style HTML export", () => {
		const html =
			'<dt><a href="https://example.com/post-1" time_added="123">Post 1</a></dt>' +
			'<dt><a href="https://example.com/post-2" time_added="456">Post 2</a></dt>';

		const result = extractUrls(Buffer.from(html));

		expect(result.urls).toEqual([
			"https://example.com/post-1",
			"https://example.com/post-2",
		]);
	});

	it("extracts URLs nested inside JSON values", () => {
		const json = JSON.stringify({
			items: [
				{ url: "https://example.com/a" },
				{ url: "https://example.com/b" },
			],
		});

		const result = extractUrls(Buffer.from(json));

		expect(result.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
	});

	it("strips trailing punctuation commonly found in prose", () => {
		const text = "see (https://example.com/post), also https://example.org/post.";

		const result = extractUrls(Buffer.from(text));

		expect(result.urls).toEqual([
			"https://example.com/post",
			"https://example.org/post",
		]);
	});

	it("extracts URLs from a Netscape bookmarks file Chrome, Firefox, Safari and Edge export", () => {
		const html = [
			"<!DOCTYPE NETSCAPE-Bookmark-file-1>",
			"<TITLE>Bookmarks</TITLE>",
			"<DL><p>",
			'<DT><H3 ADD_DATE="1700000000">Reading</H3>',
			"<DL><p>",
			'<DT><A HREF="https://example.com/a" ADD_DATE="1700000001">A</A>',
			"<DL><p>",
			'<DT><A HREF="https://example.com/b" ADD_DATE="1700000002">B</A>',
			"</DL><p>",
			"</DL><p>",
			'<DT><A HREF="https://example.org/c" ADD_DATE="1700000003">C</A>',
			"</DL><p>",
		].join("\n");

		const result = extractUrls(Buffer.from(html));

		expect(result.urls).toEqual([
			"https://example.com/a",
			"https://example.com/b",
			"https://example.org/c",
		]);
	});

	it("extracts both the feed and site URLs from an OPML subscription list", () => {
		const opml =
			'<opml version="2.0"><body>' +
			'<outline text="Example" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com/"/>' +
			"</body></opml>";

		const result = extractUrls(Buffer.from(opml));

		expect(result.urls).toEqual([
			"https://example.com/feed.xml",
			"https://example.com/",
		]);
	});

	it("extracts the target of Markdown inline links", () => {
		const markdown =
			"Read [Post](https://example.com/post) and <https://example.com/angle> later.";

		const result = extractUrls(Buffer.from(markdown));

		expect(result.urls).toEqual([
			"https://example.com/post",
			"https://example.com/angle",
		]);
	});

	it("extracts the URL column from an Instapaper-style CSV export", () => {
		const csv = [
			"URL,Title,Selection,Folder,Timestamp",
			'https://example.com/a,"A title, with a comma",,Unread,1700000000',
			"https://example.com/b,Plain title,,Unread,1700000001",
		].join("\n");

		const result = extractUrls(Buffer.from(csv));

		expect(result.urls).toEqual([
			"https://example.com/a",
			"https://example.com/b",
		]);
	});

	it("extracts the url column of a Pocket CSV export, where it is not the first column", () => {
		const csv = [
			"title,url,time_added,tags,status",
			"Plain title,https://example.com/a,1700000000,,unread",
		].join("\r\n");

		const result = extractUrls(Buffer.from(csv));

		expect(result.urls).toEqual(["https://example.com/a"]);
	});

	it("keeps a comma inside a URL path", () => {
		const result = extractUrls(Buffer.from("see https://example.com/a,b/c today"));

		expect(result.urls).toEqual(["https://example.com/a,b/c"]);
	});

	it.each([
		["a bare URL", "https://en.wikipedia.org/wiki/Foo_(bar)"],
		["a Markdown link target", "[Foo](https://en.wikipedia.org/wiki/Foo_(bar))"],
		["a URL ending a sentence", "https://en.wikipedia.org/wiki/Foo_(bar)."],
	])("keeps balanced parentheses inside %s", (_case, text) => {
		const result = extractUrls(Buffer.from(text));

		expect(result.urls).toEqual(["https://en.wikipedia.org/wiki/Foo_(bar)"]);
	});

	it.each([
		["a Markdown link followed by text", "[a](https://x.com/a)more", ["https://x.com/a"]],
		["adjacent parenthesised URLs", "(https://a.example/x)(https://b.example/y)", ["https://a.example/x", "https://b.example/y"]],
		["a parenthesised URL followed by text", "see (https://a.example/x)and more", ["https://a.example/x"]],
		["a CSS url() value", "background:url(https://a.example/x.png)no-repeat", ["https://a.example/x.png"]],
	])("ends the URL at the closing parenthesis of %s", (_case, text, urls) => {
		const result = extractUrls(Buffer.from(text));

		expect(result.urls).toEqual(urls);
	});

	it("returns an empty list when the buffer contains no URLs", () => {
		const result = extractUrls(Buffer.from("No links here. Just prose."));

		expect(result.urls).toEqual([]);
		expect(result.truncated).toBe(false);
		expect(result.totalFound).toBe(0);
	});

	it("skips matches that fail URL parsing after trailing punctuation is stripped", () => {
		// `http://.` matches the URL_REGEX (it has at least one char after `://`),
		// but stripping the trailing `.` leaves `http://` which fails `new URL()`.
		// This forces the !parsed.success branch in collectImportLinks.
		const text = "see http://. for details";

		const result = extractUrls(Buffer.from(text));

		expect(result.urls).toEqual([]);
	});
});
