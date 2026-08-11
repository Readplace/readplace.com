import { buildFailedUrlLines, selectSaveableTabs, summarizeBulkSave } from "./save-all-tabs";

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

	it("saves a tab still mid-navigation via its pendingUrl", () => {
		expect(
			selectSaveableTabs(
				[
					{ id: 1, url: "", pendingUrl: "https://example.com/loading", title: "Loading" },
					{ id: 2, url: "https://example.com/done", title: "Done" },
				],
				appDomains,
			),
		).toEqual([
			{ url: "https://example.com/loading", title: "Loading", tabId: 1 },
			{ url: "https://example.com/done", title: "Done", tabId: 2 },
		]);
	});

	it("applies the scheme and app-domain filters to the pendingUrl it resolved", () => {
		expect(
			selectSaveableTabs(
				[
					{ id: 1, url: "", pendingUrl: "chrome://settings" },
					{ id: 2, url: "", pendingUrl: "https://readplace.com/queue" },
					{ id: 3, url: "", pendingUrl: "https://example.com/keep", title: "Keep" },
				],
				appDomains,
			),
		).toEqual([{ url: "https://example.com/keep", title: "Keep", tabId: 3 }]);
	});

	it("dedupes a mid-navigation tab against its committed twin", () => {
		expect(
			selectSaveableTabs(
				[
					{ id: 1, url: "https://example.com/a", title: "Committed" },
					{ id: 2, url: "", pendingUrl: "https://example.com/a", title: "Loading" },
				],
				appDomains,
			),
		).toEqual([{ url: "https://example.com/a", title: "Committed", tabId: 1 }]);
	});
});

describe("summarizeBulkSave", () => {
	const noTooBig: { url: string; mb: number }[] = [];

	it("folds client-skipped tabs (tabCount - saveableCount) into the server's skipped count", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 2, skipped: 1, failed: 0, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 0, unauthorized: false },
				tabCount: 5,
				saveableCount: 3,
			}),
		).toEqual({ title: "Tabs saved", summary: "Saved 2 · Skipped 3", tooBig: null });
	});

	it("appends a Failed segment when the server reports failures", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 1, skipped: 0, failed: 2, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 0, unauthorized: false },
				tabCount: 3,
				saveableCount: 3,
			}).summary,
		).toBe("Saved 1 · Skipped 0 · Failed 2");
	});

	it("omits the Failed segment when there are no failures", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 0, skipped: 0, failed: 0, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 0, unauthorized: false },
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
					failedUrls: [],
					alreadySaved: 0,
					pendingRetry: 0,
					unauthorized: false,
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
				result: { saved: 1, skipped: 0, failed: 0, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 0, unauthorized: false },
				tabCount: 1,
				saveableCount: 1,
			}).tooBig,
		).toBeNull();
	});

	it("partitions merged tabs out of the Saved segment so the segments sum to the tab count", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 5, skipped: 0, failed: 0, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 2, pendingRetry: 0, unauthorized: false },
				tabCount: 5,
				saveableCount: 5,
			}).summary,
		).toBe("Saved 3 · Already in queue 2 · Skipped 0");
	});

	it("titles the report Not signed in when the session died mid-run", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 2, skipped: 0, failed: 3, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 0, unauthorized: true },
				tabCount: 5,
				saveableCount: 5,
			}).title,
		).toBe("Not signed in");
	});

	it("counts tabs queued for a background retry in their own segment", () => {
		expect(
			summarizeBulkSave({
				result: { saved: 3, skipped: 0, failed: 0, tooBig: noTooBig, skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 4, unauthorized: false },
				tabCount: 7,
				saveableCount: 7,
			}).summary,
		).toBe("Saved 3 · Skipped 0 · Retrying 4");
	});
});

describe("buildFailedUrlLines", () => {
	it("names each failed tab by its url", () => {
		expect(
			buildFailedUrlLines([{ url: "https://example.com/a" }, { url: "https://example.com/b" }]),
		).toEqual(["Couldn't save https://example.com/a", "Couldn't save https://example.com/b"]);
	});

	it("caps the list and reports how many more failed", () => {
		const failedUrls = Array.from({ length: 7 }, (_v, i) => ({ url: `https://example.com/tab-${i}` }));
		expect(buildFailedUrlLines(failedUrls)).toEqual([
			"Couldn't save https://example.com/tab-0",
			"Couldn't save https://example.com/tab-1",
			"Couldn't save https://example.com/tab-2",
			"Couldn't save https://example.com/tab-3",
			"Couldn't save https://example.com/tab-4",
			"And 2 more.",
		]);
	});
});
