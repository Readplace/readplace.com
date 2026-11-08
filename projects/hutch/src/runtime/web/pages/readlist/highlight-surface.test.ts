import assert from "node:assert/strict";
import { HighlightIdSchema } from "@packages/domain/article";
import { highlightActionUrl, highlightReaderLocation } from "./highlight-surface";
import { type LinkParams, parseReadlistUrl, readlistReturnQuery } from "./readlist.url";

const ARTICLE_ID = "0123456789abcdef0123456789abcdef";
const HIGHLIGHT_ID = HighlightIdSchema.parse("0b8f6c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e");
const CREATE_PATH = `/queue/${ARTICLE_ID}/highlights`;

function linkParams(query: string): LinkParams {
	return [...new URLSearchParams(query)];
}

function readlistOf(query: Record<string, unknown>): LinkParams {
	return linkParams(readlistReturnQuery(parseReadlistUrl(query)).slice(1));
}

describe("highlightActionUrl", () => {
	it("carries only the flag for a request with no native surface", () => {
		const url = highlightActionUrl({ path: CREATE_PATH, readlist: [], surface: [], enabled: true });

		assert.equal(url, `${CREATE_PATH}?feature=highlight`);
	});

	it("keeps the iOS surface ahead of the flag", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: [],
			surface: linkParams("platform=ios"),
			enabled: true,
		});

		assert.equal(url, `${CREATE_PATH}?platform=ios&feature=highlight`);
	});

	it("keeps both native markers, then the flag", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: [],
			surface: linkParams("platform=android&shell=app"),
			enabled: true,
		});

		assert.equal(url, `${CREATE_PATH}?platform=android&shell=app&feature=highlight`);
	});

	it("carries only the surface when the flag is off", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: [],
			surface: linkParams("platform=ios"),
			enabled: false,
		});

		assert.equal(url, `${CREATE_PATH}?platform=ios`);
	});

	it("leaves the path bare when there is nothing to carry", () => {
		const url = highlightActionUrl({ path: CREATE_PATH, readlist: [], surface: [], enabled: false });

		assert.equal(url, CREATE_PATH);
	});

	it("puts the readlist first, as the queue param, then the surface and the flag", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: readlistOf({ readlist: "work" }),
			surface: linkParams("platform=ios"),
			enabled: true,
		});

		assert.equal(url, `${CREATE_PATH}?queue=work&platform=ios&feature=highlight`);
	});
});

describe("highlightReaderLocation", () => {
	it("lands the reader on the highlight it just made", () => {
		const location = highlightReaderLocation({
			articleId: ARTICLE_ID,
			readlist: [],
			surface: linkParams("platform=ios"),
			enabled: true,
			fragment: { highlightId: HIGHLIGHT_ID },
		});

		assert.equal(location, `/queue/${ARTICLE_ID}/view?platform=ios&feature=highlight#highlight-${HIGHLIGHT_ID}`);
	});

	it("lands the reader on the rail after a delete", () => {
		const location = highlightReaderLocation({
			articleId: ARTICLE_ID,
			readlist: readlistOf({ readlist: "work" }),
			surface: [],
			enabled: true,
			fragment: "rail",
		});

		assert.equal(location, `/queue/${ARTICLE_ID}/view?queue=work&feature=highlight#highlights-rail`);
	});
});
