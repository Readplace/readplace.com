import { appendCrawlVersion } from "./crawl-versions";

describe("appendCrawlVersion", () => {
	it("prepends a new minute id as the newest version", () => {
		const result = appendCrawlVersion(["2026-07-09T08:00Z"], "2026-07-10T09:41Z");
		expect(result.changed).toBe(true);
		expect(result.next).toEqual(["2026-07-10T09:41Z", "2026-07-09T08:00Z"]);
	});

	it("records the first version onto an empty log", () => {
		const result = appendCrawlVersion([], "2026-07-10T09:41Z");
		expect(result.changed).toBe(true);
		expect(result.next).toEqual(["2026-07-10T09:41Z"]);
	});

	it("treats a same-minute re-record as a no-op (idempotent overwrite)", () => {
		const existing = ["2026-07-10T09:41Z", "2026-07-09T08:00Z"];
		const result = appendCrawlVersion(existing, "2026-07-10T09:41Z");
		expect(result.changed).toBe(false);
		expect(result.next).toEqual(existing);
	});

	it("dedupes on membership even when the minute id is not the newest entry", () => {
		const existing = ["2026-07-10T09:41Z", "2026-07-08T07:00Z"];
		const result = appendCrawlVersion(existing, "2026-07-08T07:00Z");
		expect(result.changed).toBe(false);
		expect(result.next).toEqual(existing);
	});

	it("retains every version without a cap, keeping the oldest entry (versions are stored forever)", () => {
		// 20 newest-first versions — well beyond the reader's display window.
		const existing = Array.from(
			{ length: 20 },
			(_v, i) => `2026-07-${String(20 - i).padStart(2, "0")}T00:00Z`,
		);
		const result = appendCrawlVersion(existing, "2026-08-01T00:00Z");
		expect(result.changed).toBe(true);
		expect(result.next.length).toBe(existing.length + 1);
		expect(result.next[0]).toBe("2026-08-01T00:00Z");
		expect(result.next).toContain("2026-07-01T00:00Z");
	});
});
