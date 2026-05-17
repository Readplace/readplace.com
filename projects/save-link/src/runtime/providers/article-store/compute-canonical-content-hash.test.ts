import assert from "node:assert/strict";
import { computeCanonicalContentHash } from "./compute-canonical-content-hash";

describe("computeCanonicalContentHash", () => {
	it("returns the same hash for identical canonical HTML", () => {
		const html = "<p>Hello world.</p>";

		assert.equal(computeCanonicalContentHash(html), computeCanonicalContentHash(html));
	});

	it("returns the same hash when only ad/tracking markup differs but readable text is identical (server-decoy resistance)", () => {
		const withoutAds = "<article><p>Hello world.</p></article>";
		const withAds =
			"<article><p>Hello world.</p><script src=\"https://tracker.example/pixel.js\"></script><div class=\"ad\"></div></article>";

		assert.equal(
			computeCanonicalContentHash(withoutAds),
			computeCanonicalContentHash(withAds),
		);
	});

	it("returns different hashes when the readable text differs", () => {
		const a = "<p>Hello world.</p>";
		const b = "<p>Hello universe.</p>";

		assert.notEqual(computeCanonicalContentHash(a), computeCanonicalContentHash(b));
	});

	it("returns a 64-character lowercase hex sha256 string", () => {
		const hash = computeCanonicalContentHash("<p>Hello world.</p>");

		assert.equal(hash.length, 64);
		assert.match(hash, /^[0-9a-f]{64}$/);
	});
});
