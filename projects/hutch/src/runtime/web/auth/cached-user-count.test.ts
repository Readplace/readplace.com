import { initCachedUserCount } from "./cached-user-count";

describe("initCachedUserCount", () => {
	it("serves a cached value within the TTL without re-counting", async () => {
		let now = 1_000;
		const countUsers = jest.fn(async () => 42);
		const cachedCount = initCachedUserCount({ countUsers, now: () => now, ttlMs: 1_000 });

		expect(await cachedCount()).toBe(42);
		now = 1_500;
		expect(await cachedCount()).toBe(42);

		expect(countUsers).toHaveBeenCalledTimes(1);
	});

	it("re-counts once the TTL has elapsed", async () => {
		let now = 1_000;
		let next = 42;
		const countUsers = jest.fn(async () => next);
		const cachedCount = initCachedUserCount({ countUsers, now: () => now, ttlMs: 1_000 });

		expect(await cachedCount()).toBe(42);
		now = 2_100;
		next = 99;
		expect(await cachedCount()).toBe(99);

		expect(countUsers).toHaveBeenCalledTimes(2);
	});

	it("shares one in-flight count across concurrent misses", async () => {
		let resolveCount: ((value: number) => void) | undefined;
		const countUsers = jest.fn(() => new Promise<number>((resolve) => {
			resolveCount = resolve;
		}));
		const cachedCount = initCachedUserCount({ countUsers, now: () => 1_000, ttlMs: 1_000 });

		const first = cachedCount();
		const second = cachedCount();
		resolveCount?.(7);

		expect(await first).toBe(7);
		expect(await second).toBe(7);
		expect(countUsers).toHaveBeenCalledTimes(1);
	});

	it("does not cache a failure — the next call retries", async () => {
		let now = 1_000;
		const countUsers = jest
			.fn<Promise<number>, []>()
			.mockRejectedValueOnce(new Error("scan failed"))
			.mockResolvedValueOnce(5);
		const cachedCount = initCachedUserCount({ countUsers, now: () => now, ttlMs: 1_000 });

		await expect(cachedCount()).rejects.toThrow("scan failed");
		now = 1_100;
		expect(await cachedCount()).toBe(5);

		expect(countUsers).toHaveBeenCalledTimes(2);
	});
});
