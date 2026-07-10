import { MAX_CRAWL_VERSIONS, appendCrawlVersion } from "./crawl-versions";

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

	it("caps the log at MAX_CRAWL_VERSIONS, dropping the oldest entry", () => {
		const existing = Array.from(
			{ length: MAX_CRAWL_VERSIONS },
			(_v, i) => `2026-07-${String(i + 1).padStart(2, "0")}T00:00Z`,
		);
		const result = appendCrawlVersion(existing, "2026-08-01T00:00Z");
		expect(result.changed).toBe(true);
		expect(result.next.length).toBe(MAX_CRAWL_VERSIONS);
		expect(result.next[0]).toBe("2026-08-01T00:00Z");
		expect(result.next).not.toContain("2026-07-10T00:00Z");
	});
});
