import assert from "node:assert/strict";
import { initInMemoryPendingViewHighlights } from "./in-memory-pending-view-highlights";

const ITEM = { url: "https://example.com/post", exact: "A second", prefix: "", suffix: "" };

describe("initInMemoryPendingViewHighlights", () => {
	it("hands a stored row to its first claim only", async () => {
		const store = initInMemoryPendingViewHighlights({ now: () => new Date(0) });
		await store.storePendingViewHighlights({ pendingId: "p-1", articleUrl: ITEM.url, items: [ITEM] });

		assert.deepEqual(await store.claimPendingViewHighlights("p-1"), { articleUrl: ITEM.url, items: [ITEM] });
		assert.equal(await store.claimPendingViewHighlights("p-1"), undefined);
	});

	it("claims nothing a day after the row was stored", async () => {
		let nowMs = 0;
		const store = initInMemoryPendingViewHighlights({ now: () => new Date(nowMs) });
		await store.storePendingViewHighlights({ pendingId: "p-1", articleUrl: ITEM.url, items: [ITEM] });

		nowMs = 86_400_000;

		assert.equal(await store.claimPendingViewHighlights("p-1"), undefined);
	});
});
