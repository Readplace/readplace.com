import { normalizeCrawlVersion } from "./crawl-version-log";

describe("normalizeCrawlVersion", () => {
	it("lifts a legacy bare minute-id string into an authorless entry", () => {
		expect(normalizeCrawlVersion("2026-07-10T09:41Z")).toEqual({
			minuteId: "2026-07-10T09:41Z",
		});
	});

	it("passes an attributed entry through unchanged", () => {
		expect(
			normalizeCrawlVersion({ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" }),
		).toEqual({ minuteId: "2026-07-10T09:41Z", authorUserId: "user-1" });
	});
});
