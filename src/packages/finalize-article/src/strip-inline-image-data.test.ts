import assert from "node:assert/strict";
import {
	MAX_INLINE_IMAGE_DATA_URI_BYTES,
	stripOversizedInlineImages,
} from "./strip-inline-image-data";

describe("stripOversizedInlineImages", () => {
	const bigPayload = "A".repeat(MAX_INLINE_IMAGE_DATA_URI_BYTES + 1);

	it("replaces an oversized inline base64 image with a 1×1 placeholder", () => {
		const html = `<img src="data:image/png;base64,${bigPayload}">`;
		const out = stripOversizedInlineImages(html);
		assert.ok(!out.includes(bigPayload), "oversized payload must be gone");
		assert.ok(out.includes("data:image/gif;base64,"), "replaced with placeholder");
		assert.ok(out.startsWith('<img src="') && out.endsWith('">'), "tag stays intact");
	});

	it("keeps a small inline base64 image verbatim", () => {
		const html = `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">`;
		assert.equal(stripOversizedInlineImages(html), html);
	});

	it("leaves http(s) image sources untouched", () => {
		const html = `<img src="https://cdn.example.com/a.png"><p>text</p>`;
		assert.equal(stripOversizedInlineImages(html), html);
	});

	it("strips every oversized image when several are present", () => {
		const html = `<img src="data:image/jpeg;base64,${bigPayload}"><img src="data:image/webp;base64,${bigPayload}">`;
		const out = stripOversizedInlineImages(html);
		assert.ok(!out.includes(bigPayload));
		assert.equal(out.match(/data:image\/gif;base64,/g)?.length, 2);
	});

	it("absorbs newline-wrapped base64 payloads", () => {
		const wrapped = `${"A".repeat(76)}\n`.repeat(40);
		const html = `<img src="data:image/png;base64,${wrapped}">`;
		const out = stripOversizedInlineImages(html);
		assert.ok(!out.includes(wrapped), "wrapped payload must be gone");
		assert.ok(out.includes("data:image/gif;base64,"));
		assert.ok(out.length < 120, "body shrank to the placeholder");
	});

	it("returns the body unchanged when there are no inline images", () => {
		const html = "<p>just text</p>";
		assert.equal(stripOversizedInlineImages(html), html);
	});
});
