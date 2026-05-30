import assert from "node:assert/strict";
import {
	articleUrlFromReaderUrl,
	displayUrlFor,
	isReaderUrl,
	READER_SCHEME,
	toReaderUrl,
} from "./reader-location";

describe("reader-location", () => {
	it("round-trips an article URL through the reader scheme", () => {
		const url = "https://example.com/post?a=1&b=2";
		const readerUrl = toReaderUrl(url);
		assert.ok(readerUrl.startsWith(`${READER_SCHEME}://`));
		assert.equal(articleUrlFromReaderUrl(readerUrl), url);
	});

	it("identifies reader URLs", () => {
		assert.equal(isReaderUrl("reader://page/?u=x"), true);
		assert.equal(isReaderUrl("https://example.com"), false);
	});

	it("returns undefined for non-reader, malformed, and parameterless locations", () => {
		assert.equal(articleUrlFromReaderUrl("https://example.com"), undefined);
		assert.equal(articleUrlFromReaderUrl("not a valid url"), undefined);
		assert.equal(articleUrlFromReaderUrl("reader://page/"), undefined);
	});

	it("shows the article URL for reader pages and the raw location otherwise", () => {
		assert.equal(
			displayUrlFor(toReaderUrl("https://example.com/x")),
			"https://example.com/x",
		);
		assert.equal(
			displayUrlFor("https://example.com/live"),
			"https://example.com/live",
		);
	});
});
