import assert from "node:assert/strict";
import {
	decodeResurfaceCookie,
	encodeResurfaceCookie,
} from "./resurface-cookie";

describe("resurface cookie", () => {
	it("round-trips a prompt and ids", () => {
		const encoded = encodeResurfaceCookie({ prompt: "coffee", ids: ["a", "b"] });

		assert.deepEqual(decodeResurfaceCookie(encoded), { prompt: "coffee", ids: ["a", "b"] });
	});

	it("caps the stored ids at 50", () => {
		const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);

		const decoded = decodeResurfaceCookie(encodeResurfaceCookie({ prompt: "p", ids }));

		assert.equal(decoded?.ids.length, 50);
	});

	it("truncates an over-long prompt", () => {
		const prompt = "x".repeat(600);

		const decoded = decodeResurfaceCookie(encodeResurfaceCookie({ prompt, ids: [] }));

		assert.equal(decoded?.prompt.length, 500);
	});

	it("returns undefined for a missing cookie", () => {
		assert.equal(decodeResurfaceCookie(undefined), undefined);
	});

	it("returns undefined for malformed encoding", () => {
		assert.equal(decodeResurfaceCookie("%"), undefined);
		assert.equal(decodeResurfaceCookie("not-json"), undefined);
	});

	it("returns undefined when the payload fails validation", () => {
		const badShape = encodeURIComponent(JSON.stringify({ prompt: "", ids: ["a"] }));

		assert.equal(decodeResurfaceCookie(badShape), undefined);
	});
});
