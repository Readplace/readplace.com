import type { UserId } from "@packages/domain/user";
import { initInMemoryDigestQueue } from "./in-memory-digest-queue";

const USER = "user-1" as UserId;
const OTHER = "user-2" as UserId;

describe("initInMemoryDigestQueue", () => {
	it("lists a user's enqueued items with the canonical url and retained original url", async () => {
		const queue = initInMemoryDigestQueue();
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/a?utm_source=x", enqueuedAt: "t1" });

		const items = await queue.listDigestItemsByUser(USER);

		expect(items).toEqual([
			{ userId: USER, url: "example.com/a", originalUrl: "https://example.com/a?utm_source=x", enqueuedAt: "t1" },
		]);
	});

	it("dedupes a re-enqueue of the same canonical url instead of stacking", async () => {
		const queue = initInMemoryDigestQueue();
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/a?utm_source=x", enqueuedAt: "t2" });

		const items = await queue.listDigestItemsByUser(USER);

		expect(items).toHaveLength(1);
		expect(items[0]?.enqueuedAt).toBe("t2");
	});

	it("scopes list results to the requested user", async () => {
		const queue = initInMemoryDigestQueue();
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await queue.enqueueDigestItem({ userId: OTHER, url: "https://example.com/b", enqueuedAt: "t2" });

		expect(await queue.listDigestItemsByUser(USER)).toHaveLength(1);
		expect(await queue.listDigestItemsByUser(OTHER)).toHaveLength(1);
	});

	it("deletes a queued item by its canonical key", async () => {
		const queue = initInMemoryDigestQueue();
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });

		await queue.deleteDigestItem({ userId: USER, url: "example.com/a" });

		expect(await queue.listDigestItemsByUser(USER)).toEqual([]);
	});

	it("returns each distinct pending user once from a scan", async () => {
		const queue = initInMemoryDigestQueue();
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await queue.enqueueDigestItem({ userId: USER, url: "https://example.com/b", enqueuedAt: "t2" });
		await queue.enqueueDigestItem({ userId: OTHER, url: "https://example.com/c", enqueuedAt: "t3" });

		const users = await queue.scanPendingDigestUsers();

		expect(users).toEqual([USER, OTHER]);
	});
});
