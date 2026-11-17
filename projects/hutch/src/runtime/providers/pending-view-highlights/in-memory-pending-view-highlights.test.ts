import assert from "node:assert/strict";
import { initInMemoryPendingViewHighlights } from "./in-memory-pending-view-highlights";

const ITEM = { url: "https://example.com/post", exact: "A second", prefix: "", suffix: "" };

describe("initInMemoryPendingViewHighlights", () => {
	it("finds a stored row until it is released", async () => {
		const store = initInMemoryPendingViewHighlights({ now: () => new Date(0) });
		const row = { articleUrl: ITEM.url, items: [ITEM], returnTo: "/save?url=x" };
		await store.storePendingViewHighlights({ pendingId: "p-1", ...row });

		assert.deepEqual(await store.findPendingViewHighlights("p-1"), row);
		assert.deepEqual(await store.findPendingViewHighlights("p-1"), row);
		await store.releasePendingViewHighlights("p-1");
		assert.equal(await store.findPendingViewHighlights("p-1"), undefined);
	});

	it("finds nothing a day after the row was stored", async () => {
		let nowMs = 0;
		const store = initInMemoryPendingViewHighlights({ now: () => new Date(nowMs) });
		await store.storePendingViewHighlights({ pendingId: "p-1", articleUrl: ITEM.url, items: [ITEM], returnTo: undefined });
		nowMs = 86_400_000;

		assert.equal(await store.findPendingViewHighlights("p-1"), undefined);
	});
});
