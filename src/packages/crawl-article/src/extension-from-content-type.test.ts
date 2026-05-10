import { extensionFromContentType } from "./extension-from-content-type";

describe("extensionFromContentType", () => {
	it("maps known image MIME types to their canonical extension", () => {
		expect(extensionFromContentType({ contentType: "image/png", url: "https://example.com/x" })).toBe(".png");
		expect(extensionFromContentType({ contentType: "image/jpeg", url: "https://example.com/x" })).toBe(".jpg");
		expect(extensionFromContentType({ contentType: "image/gif", url: "https://example.com/x" })).toBe(".gif");
		expect(extensionFromContentType({ contentType: "image/webp", url: "https://example.com/x" })).toBe(".webp");
		expect(extensionFromContentType({ contentType: "image/svg+xml", url: "https://example.com/x" })).toBe(".svg");
		expect(extensionFromContentType({ contentType: "image/avif", url: "https://example.com/x" })).toBe(".avif");
	});

	it("strips parameters from the content-type before looking up the MIME map", () => {
		expect(
			extensionFromContentType({ contentType: "image/jpeg; charset=binary", url: "https://example.com/x" }),
		).toBe(".jpg");
	});

	it("normalizes the content-type to lowercase before MIME map lookup", () => {
		expect(extensionFromContentType({ contentType: "IMAGE/PNG", url: "https://example.com/x" })).toBe(".png");
	});

	it("falls back to the URL pathname extension when the MIME type is unknown", () => {
		expect(
			extensionFromContentType({ contentType: "image/x-custom", url: "https://cdn.example.com/photo.tiff" }),
		).toBe(".tiff");
	});

	it("returns .bin when the MIME type is unknown and the URL has no extension", () => {
		expect(
			extensionFromContentType({ contentType: "image/x-custom", url: "https://cdn.example.com/image" }),
		).toBe(".bin");
	});

	it("returns .bin when the URL is malformed and cannot be parsed", () => {
		expect(extensionFromContentType({ contentType: "image/x-custom", url: "not a url" })).toBe(".bin");
	});
});
