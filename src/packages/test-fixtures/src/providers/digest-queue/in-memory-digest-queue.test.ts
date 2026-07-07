import type { UserId } from "@packages/domain/user";
import { initInMemoryDigestQueue } from "./in-memory-digest-queue";

const USER = "user-1" as UserId;
const OTHER = "user-2" as UserId;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The in-memory fixture models no TTL, so retentionMs is irrelevant here — this
 * keeps the required contract param out of every call site. */
function enqueue(
	queue: ReturnType<typeof initInMemoryDigestQueue>,
	params: { userId: UserId; url: string; enqueuedAt: string },
) {
	return queue.enqueueDigestItem({ ...params, retentionMs: RETENTION_MS });
}

describe("initInMemoryDigestQueue", () => {
	it("lists a user's enqueued items with the canonical url and retained original url", async () => {
		const queue = initInMemoryDigestQueue();
		await enqueue(queue, { userId: USER, url: "https://example.com/a?utm_source=x", enqueuedAt: "t1" });

		const items = await queue.listDigestItemsByUser(USER);

		expect(items).toEqual([
			{ userId: USER, url: "example.com/a", originalUrl: "https://example.com/a?utm_source=x", enqueuedAt: "t1" },
		]);
	});

	it("dedupes a re-enqueue of the same canonical url instead of stacking", async () => {
		const queue = initInMemoryDigestQueue();
		await enqueue(queue, { userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await enqueue(queue, { userId: USER, url: "https://example.com/a?utm_source=x", enqueuedAt: "t2" });

		const items = await queue.listDigestItemsByUser(USER);

		expect(items).toHaveLength(1);
		expect(items[0]?.enqueuedAt).toBe("t2");
	});

	it("scopes list results to the requested user", async () => {
		const queue = initInMemoryDigestQueue();
		await enqueue(queue, { userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await enqueue(queue, { userId: OTHER, url: "https://example.com/b", enqueuedAt: "t2" });

		expect(await queue.listDigestItemsByUser(USER)).toHaveLength(1);
		expect(await queue.listDigestItemsByUser(OTHER)).toHaveLength(1);
	});

	it("deletes a queued item by its canonical key", async () => {
		const queue = initInMemoryDigestQueue();
		await enqueue(queue, { userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });

		await queue.deleteDigestItem({ userId: USER, url: "example.com/a" });

		expect(await queue.listDigestItemsByUser(USER)).toEqual([]);
	});

	it("deletes every queued item for a user, leaving other users' items intact", async () => {
		const queue = initInMemoryDigestQueue();
		await enqueue(queue, { userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await enqueue(queue, { userId: USER, url: "https://example.com/b", enqueuedAt: "t2" });
		await enqueue(queue, { userId: OTHER, url: "https://example.com/c", enqueuedAt: "t3" });

		await queue.deleteDigestByUser(USER);

		expect(await queue.listDigestItemsByUser(USER)).toEqual([]);
		expect(await queue.listDigestItemsByUser(OTHER)).toHaveLength(1);
	});

	it("returns each distinct pending user once from a scan", async () => {
		const queue = initInMemoryDigestQueue();
		await enqueue(queue, { userId: USER, url: "https://example.com/a", enqueuedAt: "t1" });
		await enqueue(queue, { userId: USER, url: "https://example.com/b", enqueuedAt: "t2" });
		await enqueue(queue, { userId: OTHER, url: "https://example.com/c", enqueuedAt: "t3" });

		const users = await queue.scanPendingDigestUsers();

		expect(users).toEqual([USER, OTHER]);
	});
});
