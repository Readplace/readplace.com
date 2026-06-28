import { selectSaveableTabs, summarizeBulkSave } from "./save-all-tabs";

describe("selectSaveableTabs", () => {
	const appDomains = ["readplace.com"];

	it("keeps http and https tabs that are not the app's own pages, carrying id and title", () => {
		expect(
			selectSaveableTabs(
				[
					{ id: 1, url: "https://example.com/a", title: "A" },
					{ id: 2, url: "http://example.org/b", title: "B" },
				],
				appDomains,
			),
		).toEqual([
			{ url: "https://example.com/a", title: "A", tabId: 1 },
			{ url: "http://example.org/b", title: "B", tabId: 2 },
		]);
	});

	it("falls back to the url as the title when a tab has none", () => {
		expect(selectSaveableTabs([{ id: 3, url: "https://example.com/a" }], appDomains)).toEqual([
			{ url: "https://example.com/a", title: "https://example.com/a", tabId: 3 },
		]);
	});

	it("drops tabs that have no url", () => {
		expect(selectSaveableTabs([{ url: undefined }, {}], appDomains)).toEqual([]);
	});

	it("drops non-http(s) schemes (chrome://, about:, file:, moz-extension://)", () => {
		expect(
			selectSaveableTabs(
				[
					{ url: "chrome://settings" },
					{ url: "about:blank" },
					{ url: "file:///tmp/x.html" },
					{ url: "moz-extension://abc/popup.html" },
					{ url: "https://example.com/keep", title: "Keep" },
				],
				appDomains,
			),
		).toEqual([{ url: "https://example.com/keep", title: "Keep", tabId: undefined }]);
	});

	it("drops the app's own pages, including localhost", () => {
		expect(
			selectSaveableTabs(
				[
					{ url: "https://readplace.com/queue" },
					{ url: "http://localhost:3000/queue" },
					{ url: "https://example.com/keep", title: "Keep" },
				],
				appDomains,
			),
		).toEqual([{ url: "https://example.com/keep", title: "Keep", tabId: undefined }]);
	});

	it("matches the http(s) scheme case-insensitively", () => {
		expect(selectSaveableTabs([{ id: 4, url: "HTTPS://example.com/a", title: "A" }], appDomains)).toEqual([
			{ url: "HTTPS://example.com/a", title: "A", tabId: 4 },
		]);
	});

	it("dedupes tabs open on the same url, keeping the first seen", () => {
		expect(
			selectSaveableTabs(
				[
					{ id: 1, url: "https://example.com/a", title: "First" },
					{ id: 2, url: "https://example.com/a", title: "Second" },
					{ id: 3, url: "https://example.com/b", title: "B" },
				],
				appDomains,
			),
		).toEqual([
			{ url: "https://example.com/a", title: "First", tabId: 1 },
			{ url: "https://example.com/b", title: "B", tabId: 3 },
		]);
	});
});

describe("summarizeBulkSave", () => {
	const noTooBig: { url: string; mb: number }[] = [];

	it("folds client-skipped tabs (tabCount - saveableCount) into the server's skipped count", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 2, skipped: 1, failed: 0, tooBig: noTooBig, skippedUrls: [] },
				tabCount: 5,
				saveableCount: 3,
			}),
		).toEqual({ title: "Tabs saved", summary: "Saved 2 · Skipped 3", tooBig: null });
	});

	it("appends a Failed segment when the server reports failures", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 1, skipped: 0, failed: 2, tooBig: noTooBig, skippedUrls: [] },
				tabCount: 3,
				saveableCount: 3,
			}).summary,
		).toBe("Saved 1 · Skipped 0 · Failed 2");
	});

	it("omits the Failed segment when there are no failures", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 0, skipped: 0, failed: 0, tooBig: noTooBig, skippedUrls: [] },
				tabCount: 0,
				saveableCount: 0,
			}).summary,
		).toBe("Saved 0 · Skipped 0");
	});

	it("lists pages that were too large to capture in full", () => {
		expect(
			summarizeBulkSave({
				result: {
					saved: 2,
					skipped: 0,
					failed: 0,
					tooBig: [
						{ url: "https://example.com/big", mb: 25 },
						{ url: "https://example.com/huge", mb: 40 },
					],
					skippedUrls: [],
				},
				tabCount: 2,
				saveableCount: 2,
			}).tooBig,
		).toBe(
			"Some pages were too large to capture in full (saved as links): https://example.com/big (25 MB), https://example.com/huge (40 MB)",
		);
	});

	it("reports no too-big line when every page fit", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 1, skipped: 0, failed: 0, tooBig: noTooBig, skippedUrls: [] },
				tabCount: 1,
				saveableCount: 1,
			}).tooBig,
		).toBeNull();
	});
});
