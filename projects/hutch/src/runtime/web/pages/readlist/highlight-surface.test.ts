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
	it("keeps the iOS surface", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: [],
			surface: linkParams("platform=ios"),
		});

		assert.equal(url, `${CREATE_PATH}?platform=ios`);
	});

	it("keeps both native markers", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: [],
			surface: linkParams("platform=android&shell=app"),
		});

		assert.equal(url, `${CREATE_PATH}?platform=android&shell=app`);
	});

	it("leaves the path bare when there is nothing to carry", () => {
		const url = highlightActionUrl({ path: CREATE_PATH, readlist: [], surface: [] });

		assert.equal(url, CREATE_PATH);
	});

	it("puts the readlist first, as the queue param, then the surface", () => {
		const url = highlightActionUrl({
			path: CREATE_PATH,
			readlist: readlistOf({ readlist: "work" }),
			surface: linkParams("platform=ios"),
		});

		assert.equal(url, `${CREATE_PATH}?queue=work&platform=ios`);
	});
});

describe("highlightReaderLocation", () => {
	it("lands the reader on the highlight it just made", () => {
		const location = highlightReaderLocation({
			articleId: ARTICLE_ID,
			readlist: [],
			surface: linkParams("platform=ios"),
			fragment: { highlightId: HIGHLIGHT_ID },
		});

		assert.equal(location, `/queue/${ARTICLE_ID}/view?platform=ios#highlight-${HIGHLIGHT_ID}`);
	});

	it("lands the reader on the rail after a delete", () => {
		const location = highlightReaderLocation({
			articleId: ARTICLE_ID,
			readlist: readlistOf({ readlist: "work" }),
			surface: [],
			fragment: "rail",
		});

		assert.equal(location, `/queue/${ARTICLE_ID}/view?queue=work#highlights-rail`);
	});
});
