import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { renderShareBalloon } from "./share-balloon.component";

function parse(html: string): Document {
	return new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`).window
		.document;
}

function shareUrl(doc: Document): URL {
	const btn = doc.querySelector("[data-test-share-balloon]");
	assert(btn, "share button must be rendered");
	const href = btn.getAttribute("data-share-url");
	assert(href, "share button must carry a data-share-url");
	return new URL(href);
}

function copyUrl(doc: Document): URL {
	const btn = doc.querySelector("[data-test-share-balloon-copy]");
	assert(btn, "copy button must be rendered");
	const href = btn.getAttribute("data-share-url");
	assert(href, "copy button must carry a data-share-url");
	return new URL(href);
}

describe("renderShareBalloon", () => {
	it("stamps utm_content with the sharer prefix on both share and copy URLs when provided", () => {
		const html = renderShareBalloon({
			shareUrl: "https://readplace.com/view/x",
			shareTitle: "A title",
			shareHint: "share me",
			shareSource: "reader-internal",
			sharerUserIdPrefix: "abcdef",
		});
		const doc = parse(html);

		assert.equal(shareUrl(doc).searchParams.get("utm_content"), "abcdef");
		assert.equal(copyUrl(doc).searchParams.get("utm_content"), "abcdef");
	});

	it("omits utm_content when no sharer prefix is provided", () => {
		const html = renderShareBalloon({
			shareUrl: "https://readplace.com/view/x",
			shareTitle: "A title",
			shareHint: "share me",
			shareSource: "reader-public",
		});
		const doc = parse(html);

		assert.equal(shareUrl(doc).searchParams.get("utm_content"), null);
		assert.equal(copyUrl(doc).searchParams.get("utm_content"), null);
	});
});
