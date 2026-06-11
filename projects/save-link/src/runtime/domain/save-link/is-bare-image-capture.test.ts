import assert from "node:assert/strict";
import { isBareImageCapture } from "./is-bare-image-capture";

describe("isBareImageCapture", () => {
	it("is true when a candidate resolves to the page URL itself (browser image-viewer shape)", () => {
		assert.equal(
			isBareImageCapture({
				candidates: ["https://example.com/photo.jpg?cb=1"],
				url: "https://example.com/photo.jpg?cb=1",
			}),
			true,
		);
	});

	it("normalises both sides so an equivalent URL still matches", () => {
		assert.equal(
			isBareImageCapture({
				candidates: ["https://example.com:443/photo.jpg"],
				url: "https://example.com/photo.jpg",
			}),
			true,
		);
	});

	it("is false when no candidate is the page itself (a real article's images differ from its URL)", () => {
		assert.equal(
			isBareImageCapture({
				candidates: ["https://example.com/og.png", "https://cdn.example.com/hero.jpg"],
				url: "https://example.com/article",
			}),
			false,
		);
	});

	it("is false when there are no image candidates", () => {
		assert.equal(isBareImageCapture({ candidates: [], url: "https://example.com/article" }), false);
	});
});
