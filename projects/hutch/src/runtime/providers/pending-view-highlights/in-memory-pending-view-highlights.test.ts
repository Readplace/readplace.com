import assert from "node:assert/strict";
import { initInMemoryPendingViewHighlights } from "./in-memory-pending-view-highlights";

const ITEM = { url: "https://example.com/post", exact: "A second", prefix: "", suffix: "" };

describe("initInMemoryPendingViewHighlights", () => {
	it("finds a stored row until it is released", async () => {
		const store = initInMemoryPendingViewHighlights({ now: () => new Date(0) });
		await store.storePendingViewHighlights({ pendingId: "p-1", articleUrl: ITEM.url, items: [ITEM] });

		assert.deepEqual(await store.findPendingViewHighlights("p-1"), { articleUrl: ITEM.url, items: [ITEM] });
		assert.deepEqual(await store.findPendingViewHighlights("p-1"), { articleUrl: ITEM.url, items: [ITEM] });
		await store.releasePendingViewHighlights("p-1");
		assert.equal(await store.findPendingViewHighlights("p-1"), undefined);
	});

	it("finds nothing a day after the row was stored", async () => {
		let nowMs = 0;
		const store = initInMemoryPendingViewHighlights({ now: () => new Date(nowMs) });
		await store.storePendingViewHighlights({ pendingId: "p-1", articleUrl: ITEM.url, items: [ITEM] });
		nowMs = 86_400_000;

		assert.equal(await store.findPendingViewHighlights("p-1"), undefined);
	});
});
