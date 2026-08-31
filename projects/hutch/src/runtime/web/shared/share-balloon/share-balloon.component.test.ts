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
	it("carries only source, medium and campaign on the share and copy URLs", () => {
		const html = renderShareBalloon({
			shareUrl: "https://readplace.com/view/x",
			shareTitle: "A title",
			shareHint: "share me",
			shareSource: "reader-public",
		});
		const doc = parse(html);

		const share = shareUrl(doc);
		assert.deepEqual([...share.searchParams.keys()], ["utm_source", "utm_medium", "utm_campaign"]);
		assert.equal(share.searchParams.get("utm_source"), "share-balloon");
		assert.equal(share.searchParams.get("utm_medium"), "share");
		assert.equal(share.searchParams.get("utm_campaign"), "reader-public");

		const copy = copyUrl(doc);
		assert.deepEqual([...copy.searchParams.keys()], ["utm_source", "utm_medium", "utm_campaign"]);
		assert.equal(copy.searchParams.get("utm_source"), "share-balloon");
		assert.equal(copy.searchParams.get("utm_medium"), "copy");
		assert.equal(copy.searchParams.get("utm_campaign"), "reader-public");
	});

	it("stamps the share-beacon target on the wrap when a shareStampUrl is given", () => {
		const html = renderShareBalloon({
			shareUrl: "https://readplace.com/view/x",
			shareTitle: "A title",
			shareHint: "share me",
			shareSource: "reader-internal",
			shareStampUrl: "/queue/abc123/share",
		});
		const wrap = parse(html).querySelector("[data-test-share-balloon-wrap]");

		assert(wrap, "the balloon wrap must render");
		assert.equal(wrap.getAttribute("data-share-stamp-url"), "/queue/abc123/share");
	});

	it("omits the share-beacon target on the wrap when no shareStampUrl is given, as on public /view", () => {
		const html = renderShareBalloon({
			shareUrl: "https://readplace.com/view/x",
			shareTitle: "A title",
			shareHint: "share me",
			shareSource: "reader-public",
		});
		const wrap = parse(html).querySelector("[data-test-share-balloon-wrap]");

		assert(wrap, "the balloon wrap must render");
		assert.equal(wrap.getAttribute("data-share-stamp-url"), null);
	});
});
