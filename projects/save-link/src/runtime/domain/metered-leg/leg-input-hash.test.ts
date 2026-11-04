import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { legInputHash } from "./leg-input-hash";

describe("legInputHash", () => {
	it("hashes the url, leg and inputs joined by newlines", () => {
		const expected = createHash("sha256")
			.update("https://example.com/a\nsummary\nhash-1\nhash-2")
			.digest("hex");

		assert.equal(
			legInputHash({ url: "https://example.com/a", leg: "summary", inputs: ["hash-1", "hash-2"] }),
			expected,
		);
	});

	it("gives a different hash when an input changes", () => {
		const first = legInputHash({ url: "https://example.com/a", leg: "content-judge", inputs: ["x"] });
		const second = legInputHash({ url: "https://example.com/a", leg: "content-judge", inputs: ["y"] });

		assert.notEqual(first, second);
	});

	it("gives a different hash for a different leg on the same inputs", () => {
		const judge = legInputHash({ url: "https://example.com/a", leg: "content-judge", inputs: ["x"] });
		const summary = legInputHash({ url: "https://example.com/a", leg: "summary", inputs: ["x"] });

		assert.notEqual(judge, summary);
	});
});
