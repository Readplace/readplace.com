import assert from "node:assert/strict";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";
import { initReadArticleImageByIdentity } from "./read-article-image-by-identity";

function readerHolding(bytes: Uint8Array): ReadArticleImage {
	return async () => bytes;
}

const SHARED_BYTES = new Uint8Array([1]);
const PRIVATE_BYTES = new Uint8Array([2]);

describe("initReadArticleImageByIdentity", () => {
	const read = initReadArticleImageByIdentity({ shared: readerHolding(SHARED_BYTES), private: readerHolding(PRIVATE_BYTES) });

	it("sends a private item's URL to the private reader", async () => {
		const bytes = await read({ url: "https://uploads.readplace.invalid/0123456789abcdef0123456789abcdef", filename: "a.png" });

		assert.equal(bytes, PRIVATE_BYTES);
	});

	it("sends a public URL to the shared reader", async () => {
		const bytes = await read({ url: "https://example.com/article", filename: "a.png" });

		assert.equal(bytes, SHARED_BYTES);
	});
});
