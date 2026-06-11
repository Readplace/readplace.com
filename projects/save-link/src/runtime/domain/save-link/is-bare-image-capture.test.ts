import assert from "node:assert/strict";
import { isBareImageCapture } from "./is-bare-image-capture";

describe("isBareImageCapture", () => {
	it("is true when the page URL is an image and a candidate resolves to it (browser image-viewer shape)", () => {
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

	it("matches the image extension case-insensitively (CDNs serve upper-case suffixes)", () => {
		assert.equal(
			isBareImageCapture({
				candidates: ["https://example.com/PHOTO.JPG"],
				url: "https://example.com/PHOTO.JPG",
			}),
			true,
		);
	});

	it("is false for an article whose og:image equals its own URL — the page is not an image, so its text is not discarded", () => {
		assert.equal(
			isBareImageCapture({
				candidates: ["https://example.com/article", "https://cdn.example.com/hero.jpg"],
				url: "https://example.com/article",
			}),
			false,
		);
	});

	it("is false when the page URL is an image but no candidate resolves to it (a different CDN image)", () => {
		assert.equal(
			isBareImageCapture({
				candidates: ["https://cdn.example.com/hero.jpg"],
				url: "https://example.com/photo.jpg",
			}),
			false,
		);
	});

	it("is false when there are no image candidates", () => {
		assert.equal(isBareImageCapture({ candidates: [], url: "https://example.com/photo.jpg" }), false);
	});
});
