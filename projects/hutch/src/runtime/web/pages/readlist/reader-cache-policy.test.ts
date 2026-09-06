import { READER_MAX_AGE_SECONDS, readerCachePolicy } from "./reader-cache-policy";

const CURRENT = "abc123def4567890";

describe("readerCachePolicy", () => {
	it("caches for the max age when a matching version reaches a settled reader", () => {
		expect(
			readerCachePolicy({ requestedVersion: CURRENT, currentVersion: CURRENT, settled: true }),
		).toBe(`private, max-age=${READER_MAX_AGE_SECONDS}`);
	});

	it("revalidates when no version was requested", () => {
		expect(
			readerCachePolicy({ requestedVersion: undefined, currentVersion: CURRENT, settled: true }),
		).toBe("private, no-cache");
	});

	it("revalidates when the version is a repeated (array) query parameter", () => {
		expect(
			readerCachePolicy({ requestedVersion: [CURRENT, "other"], currentVersion: CURRENT, settled: true }),
		).toBe("private, no-cache");
	});

	it("revalidates when the requested version is stale", () => {
		expect(
			readerCachePolicy({ requestedVersion: "stale000", currentVersion: CURRENT, settled: true }),
		).toBe("private, no-cache");
	});

	it("revalidates a matching version while the reader is still settling", () => {
		expect(
			readerCachePolicy({ requestedVersion: CURRENT, currentVersion: CURRENT, settled: false }),
		).toBe("private, no-cache");
	});
});
