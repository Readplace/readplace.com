import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MAX_IMAGE_BYTES } from "./image-detect";
import { parseImageFromBuffer } from "./parse-image";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function hashOf(buffer: Buffer): string {
	return createHash("sha256").update(buffer).digest("hex");
}

function response(headers: Record<string, string> = {}): Response {
	return new Response(null, { status: 200, headers });
}

describe("parseImageFromBuffer", () => {
	it("returns a fetched image result carrying the bytes for the finalizer to host", () => {
		const result = parseImageFromBuffer({
			buffer: JPEG_BYTES,
			bodyHash: hashOf(JPEG_BYTES),
			response: response({ etag: '"img-1"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" }),
			url: "https://example.com/photo.jpg?cb=1",
			contentType: "image/jpeg",
			logError: () => {},
		});

		assert.deepEqual(result, {
			status: "fetched",
			mediaType: "image",
			html: '<figure><img src="https://example.com/photo.jpg?cb=1" alt=""></figure>',
			thumbnail: {
				image: {
					body: JPEG_BYTES,
					contentType: "image/jpeg",
					url: "https://example.com/photo.jpg?cb=1",
					extension: ".jpg",
				},
				provenUnusable: [],
			},
			etag: '"img-1"',
			lastModified: "Wed, 21 Oct 2025 07:28:00 GMT",
			bodyHash: hashOf(JPEG_BYTES),
		});
	});

	it("escapes HTML-significant characters in the inline fallback src", () => {
		const result = parseImageFromBuffer({
			buffer: JPEG_BYTES,
			bodyHash: hashOf(JPEG_BYTES),
			response: response(),
			url: 'https://example.com/a"b.png',
			contentType: "image/png",
			logError: () => {},
		});

		assert.equal(result.status, "fetched");
		assert(result.status === "fetched");
		assert.equal(result.html, '<figure><img src="https://example.com/a&quot;b.png" alt=""></figure>');
	});

	it("returns unsupported with the byte count and cap when the body exceeds the cap", () => {
		const oversize = Buffer.alloc(MAX_IMAGE_BYTES.bytes + 1, 0);
		const logError = jest.fn();
		const result = parseImageFromBuffer({
			buffer: oversize,
			bodyHash: hashOf(oversize),
			response: response(),
			url: "https://example.com/huge.png",
			contentType: "image/png",
			logError,
		});

		assert.deepEqual(result, {
			status: "unsupported",
			reason: `image body too large: ${oversize.length} bytes (cap ${MAX_IMAGE_BYTES.label})`,
		});
		expect(logError).toHaveBeenCalledWith(
			`[CrawlArticle] Image body too large (${oversize.length} bytes, cap ${MAX_IMAGE_BYTES.label}) for https://example.com/huge.png`,
		);
	});
});
