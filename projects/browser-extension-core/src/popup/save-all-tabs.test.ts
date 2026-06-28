import { selectSaveableTabUrls, summarizeBulkSave } from "./save-all-tabs";

describe("selectSaveableTabUrls", () => {
	const appDomains = ["readplace.com"];

	it("keeps http and https tabs that are not the app's own pages", () => {
		expect(
			selectSaveableTabUrls(
				[{ url: "https://example.com/a" }, { url: "http://example.org/b" }],
				appDomains,
			),
		).toEqual(["https://example.com/a", "http://example.org/b"]);
	});

	it("drops tabs that have no url", () => {
		expect(selectSaveableTabUrls([{ url: undefined }, {}], appDomains)).toEqual([]);
	});

	it("drops non-http(s) schemes (chrome://, about:, file:, moz-extension://)", () => {
		expect(
			selectSaveableTabUrls(
				[
					{ url: "chrome://settings" },
					{ url: "about:blank" },
					{ url: "file:///tmp/x.html" },
					{ url: "moz-extension://abc/popup.html" },
					{ url: "https://example.com/keep" },
				],
				appDomains,
			),
		).toEqual(["https://example.com/keep"]);
	});

	it("drops the app's own pages, including localhost", () => {
		expect(
			selectSaveableTabUrls(
				[
					{ url: "https://readplace.com/queue" },
					{ url: "http://localhost:3000/queue" },
					{ url: "https://example.com/keep" },
				],
				appDomains,
			),
		).toEqual(["https://example.com/keep"]);
	});

	it("matches the http(s) scheme case-insensitively", () => {
		expect(selectSaveableTabUrls([{ url: "HTTPS://example.com/a" }], appDomains)).toEqual([
			"HTTPS://example.com/a",
		]);
	});

	it("dedupes tabs open on the same url so it is saved and counted once", () => {
		expect(
			selectSaveableTabUrls(
				[
					{ url: "https://example.com/a" },
					{ url: "https://example.com/a" },
					{ url: "https://example.com/b" },
				],
				appDomains,
			),
		).toEqual(["https://example.com/a", "https://example.com/b"]);
	});
});

describe("summarizeBulkSave", () => {
	it("folds client-skipped tabs (tabCount - saveableCount) into the server's skipped count", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 2, skipped: 1, failed: 0, skippedUrls: [] },
				tabCount: 5,
				saveableCount: 3,
			}),
		).toEqual({ title: "Tabs saved", summary: "Saved 2 · Skipped 3" });
	});

	it("appends a Failed segment when the server reports failures", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 1, skipped: 0, failed: 2, skippedUrls: [] },
				tabCount: 3,
				saveableCount: 3,
			}).summary,
		).toBe("Saved 1 · Skipped 0 · Failed 2");
	});

	it("omits the Failed segment when there are no failures", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 0, skipped: 0, failed: 0, skippedUrls: [] },
				tabCount: 0,
				saveableCount: 0,
			}).summary,
		).toBe("Saved 0 · Skipped 0");
	});
});
