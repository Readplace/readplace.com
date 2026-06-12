import assert from "node:assert/strict";
import { isBareImageCapture } from "./is-bare-image-capture";

const singleImageHtml = (src: string) =>
	`<html><head><title>image (638×359)</title></head><body><img src="${src}"></body></html>`;

describe("isBareImageCapture", () => {
	describe("URL-extension signal", () => {
		it("is true when the page URL path ends in an image extension and a candidate resolves to it (browser image-viewer shape)", () => {
			assert.equal(
				isBareImageCapture({
					html: singleImageHtml("https://example.com/photo.jpg?cb=1"),
					candidates: ["https://example.com/photo.jpg?cb=1"],
					url: "https://example.com/photo.jpg?cb=1",
				}),
				true,
			);
		});

		it("normalises both sides so an equivalent URL still matches", () => {
			assert.equal(
				isBareImageCapture({
					html: singleImageHtml("https://example.com:443/photo.jpg"),
					candidates: ["https://example.com:443/photo.jpg"],
					url: "https://example.com/photo.jpg",
				}),
				true,
			);
		});

		it("matches the image extension case-insensitively (CDNs serve upper-case suffixes)", () => {
			assert.equal(
				isBareImageCapture({
					html: singleImageHtml("https://example.com/PHOTO.JPG"),
					candidates: ["https://example.com/PHOTO.JPG"],
					url: "https://example.com/PHOTO.JPG",
				}),
				true,
			);
		});
	});

	describe("single-image-document signal (extension-less direct images)", () => {
		it("is true for an extension-less URL whose capture is a single image with no body text", () => {
			assert.equal(
				isBareImageCapture({
					html: singleImageHtml("https://example.com/media/F1ab?format=jpg"),
					candidates: ["https://example.com/media/F1ab?format=jpg"],
					url: "https://example.com/media/F1ab?format=jpg",
				}),
				true,
			);
		});

		it("is false for an extension-less self-referencing page that carries body text — a real article, so its text is not discarded", () => {
			assert.equal(
				isBareImageCapture({
					html: `<html><body><h1>Headline</h1><p>Real article text.</p><img src="https://example.com/article"></body></html>`,
					candidates: ["https://example.com/article"],
					url: "https://example.com/article",
				}),
				false,
			);
		});

		it("is false for an extension-less self-referencing page with more than one image (not the bare-image shape)", () => {
			assert.equal(
				isBareImageCapture({
					html: `<html><body><img src="https://example.com/gallery"><img src="https://cdn.example.com/other.jpg"></body></html>`,
					candidates: ["https://example.com/gallery", "https://cdn.example.com/other.jpg"],
					url: "https://example.com/gallery",
				}),
				false,
			);
		});
	});

	describe("self-reference gate", () => {
		it("is false for an article whose og:image equals its own URL — no image extension and the document has text, so both signals fail", () => {
			assert.equal(
				isBareImageCapture({
					html: `<html><body><h1>Headline</h1><p>Body.</p></body></html>`,
					candidates: ["https://example.com/article", "https://cdn.example.com/hero.jpg"],
					url: "https://example.com/article",
				}),
				false,
			);
		});

		it("is false when the page URL is an image but no candidate resolves to it (a different CDN image)", () => {
			assert.equal(
				isBareImageCapture({
					html: singleImageHtml("https://cdn.example.com/hero.jpg"),
					candidates: ["https://cdn.example.com/hero.jpg"],
					url: "https://example.com/photo.jpg",
				}),
				false,
			);
		});

		it("is false when there are no image candidates", () => {
			assert.equal(
				isBareImageCapture({
					html: "<html><body></body></html>",
					candidates: [],
					url: "https://example.com/photo.jpg",
				}),
				false,
			);
		});
	});
});
