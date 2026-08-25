import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parsePlainTextFromBuffer } from "./parse-plain-text";

function response(headers: Record<string, string> = {}): Response {
	return new Response(null, { status: 200, headers });
}

function hashOf(body: string): string {
	return createHash("sha256").update(Buffer.from(body, "utf-8")).digest("hex");
}

function htmlOf(input: { body: string; url: string; headers?: Record<string, string> }): string {
	const result = parsePlainTextFromBuffer({
		buffer: Buffer.from(input.body, "utf-8"),
		bodyHash: hashOf(input.body),
		response: response(input.headers),
		documentUrl: input.url,
	});
	assert(result.status === "fetched");
	return result.html;
}

describe("parsePlainTextFromBuffer", () => {
	it("wraps blank-line-separated blocks as <p> in a titled <article> and forwards validators", () => {
		const body = "First paragraph.\n\nSecond paragraph.\n\n   \n";
		const result = parsePlainTextFromBuffer({
			buffer: Buffer.from(body, "utf-8"),
			bodyHash: hashOf(body),
			response: response({ etag: '"abc"', "last-modified": "Wed, 21 Oct 2025 07:28:00 GMT" }),
			documentUrl: "https://example.com/docs/my_notes.txt",
		});

		assert.equal(result.status, "fetched");
		assert(result.status === "fetched");
		assert.equal(
			result.html,
			"<!DOCTYPE html><html><head><title>my notes</title></head><body><article><h1>my notes</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>",
		);
		assert.equal(result.etag, '"abc"');
		assert.equal(result.lastModified, "Wed, 21 Oct 2025 07:28:00 GMT");
		assert.equal(result.bodyHash, hashOf(body));
	});

	it("titles from a segment that has no extension, slugging separators", () => {
		const html = htmlOf({ body: "Body.", url: "https://example.com/release-notes" });
		assert.equal(
			html,
			"<!DOCTYPE html><html><head><title>release notes</title></head><body><article><h1>release notes</h1><p>Body.</p></article></body></html>",
		);
	});

	it("escapes HTML-significant characters and omits the title tags when the URL has no usable segment", () => {
		const body = "a < b & c";
		const result = parsePlainTextFromBuffer({
			buffer: Buffer.from(body, "utf-8"),
			bodyHash: hashOf(body),
			response: response(),
			documentUrl: "https://example.com/",
		});

		assert(result.status === "fetched");
		assert.equal(
			result.html,
			"<!DOCTYPE html><html><head></head><body><article><p>a &lt; b &amp; c</p></article></body></html>",
		);
		assert.equal(result.etag, undefined);
		assert.equal(result.lastModified, undefined);
	});

	it("omits the title tags when the URL cannot be parsed", () => {
		const html = htmlOf({ body: "Body.", url: "::not a url::" });
		assert.equal(
			html,
			"<!DOCTYPE html><html><head></head><body><article><p>Body.</p></article></body></html>",
		);
	});
});
