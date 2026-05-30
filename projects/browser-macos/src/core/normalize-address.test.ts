import assert from "node:assert/strict";
import { normalizeAddress } from "./normalize-address";

describe("normalizeAddress", () => {
	it("rejects empty input", () => {
		assert.deepEqual(normalizeAddress("   "), {
			ok: false,
			reason: "Type a web address to start reading.",
		});
	});

	it("accepts an absolute http(s) URL unchanged", () => {
		assert.deepEqual(normalizeAddress("https://example.com/a"), {
			ok: true,
			url: "https://example.com/a",
		});
		assert.equal(normalizeAddress("http://example.com").ok, true);
	});

	it("rejects an absolute non-web scheme", () => {
		assert.deepEqual(normalizeAddress("file:///etc/passwd"), {
			ok: false,
			reason: "Internet Reader only opens http and https pages.",
		});
	});

	it("rejects an absolute URL that cannot be parsed", () => {
		assert.equal(normalizeAddress("http://").ok, false);
	});

	it("rejects a typed non-web scheme that is not host:port", () => {
		assert.equal(normalizeAddress("javascript:alert(1)").ok, false);
	});

	it("promotes a bare host:port to https", () => {
		assert.deepEqual(normalizeAddress("localhost:3000"), {
			ok: true,
			url: "https://localhost:3000/",
		});
	});

	it("promotes a bare host with a path to https", () => {
		assert.deepEqual(normalizeAddress("example.com/path"), {
			ok: true,
			url: "https://example.com/path",
		});
	});

	it("rejects text that is not a host", () => {
		assert.deepEqual(normalizeAddress("asdf"), {
			ok: false,
			reason: "That doesn't look like a web address.",
		});
	});

	it("rejects a promotion that produces an invalid host", () => {
		assert.equal(normalizeAddress("exa mple.com").ok, false);
	});
});
