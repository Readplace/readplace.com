import { appendCrawlVersion } from "./crawl-versions";

describe("appendCrawlVersion", () => {
	it("prepends a new entry as the newest version", () => {
		const result = appendCrawlVersion(
			[{ minuteId: "2026-07-09T08:00Z" }],
			{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
		);
		expect(result.changed).toBe(true);
		expect(result.next).toEqual([
			{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
			{ minuteId: "2026-07-09T08:00Z" },
		]);
	});

	it("records the first version onto an empty log", () => {
		const result = appendCrawlVersion([], { minuteId: "2026-07-10T09:41Z" });
		expect(result.changed).toBe(true);
		expect(result.next).toEqual([{ minuteId: "2026-07-10T09:41Z" }]);
	});

	it("treats a same-minute re-record as a no-op (idempotent overwrite)", () => {
		const existing = [
			{ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" },
			{ minuteId: "2026-07-09T08:00Z" },
		];
		const result = appendCrawlVersion(existing, { minuteId: "2026-07-10T09:41Z" });
		expect(result.changed).toBe(false);
		expect(result.next).toEqual(existing);
	});

	it("dedupes against legacy bare-string entries without rewriting them", () => {
		const existing = ["2026-07-10T09:41Z", "2026-07-08T07:00Z"];
		const result = appendCrawlVersion(existing, {
			minuteId: "2026-07-08T07:00Z",
			authorUserId: "user-1",
		});
		expect(result.changed).toBe(false);
		expect(result.next).toEqual(existing);
	});

	it("prepends an entry onto a legacy log, leaving the old strings untouched", () => {
		const existing = ["2026-07-09T08:00Z"];
		const result = appendCrawlVersion(existing, { minuteId: "2026-07-10T09:41Z" });
		expect(result.changed).toBe(true);
		expect(result.next).toEqual([
			{ minuteId: "2026-07-10T09:41Z" },
			"2026-07-09T08:00Z",
		]);
	});

	it("retains every version without a cap, keeping the oldest entry (versions are stored forever)", () => {
		// 20 newest-first versions — well beyond the reader's display window.
		const existing = Array.from(
			{ length: 20 },
			(_v, i) => ({ minuteId: `2026-07-${String(20 - i).padStart(2, "0")}T00:00Z` }),
		);
		const result = appendCrawlVersion(existing, { minuteId: "2026-08-01T00:00Z" });
		expect(result.changed).toBe(true);
		expect(result.next.length).toBe(existing.length + 1);
		expect(result.next[0]).toEqual({ minuteId: "2026-08-01T00:00Z" });
		expect(result.next).toContainEqual({ minuteId: "2026-07-01T00:00Z" });
	});
});
