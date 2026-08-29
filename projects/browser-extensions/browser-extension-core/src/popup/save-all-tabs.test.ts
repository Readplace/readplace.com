import { buildSaveAllDetailLines, classifyTabs, saveAllTabsLabel, summarizeBulkSave } from "./save-all-tabs";

describe("classifyTabs", () => {
	const appDomains = ["readplace.com"];

	it("keeps http and https tabs that are not the app's own pages, carrying id and title", () => {
		expect(
			classifyTabs(
				[
					{ id: 1, url: "https://example.com/a", title: "A" },
					{ id: 2, url: "http://example.org/b", title: "B" },
				],
				appDomains,
			).saveable,
		).toEqual([
			{ url: "https://example.com/a", title: "A", tabId: 1 },
			{ url: "http://example.org/b", title: "B", tabId: 2 },
		]);
	});

	it("falls back to the url as the title when a tab has none", () => {
		expect(classifyTabs([{ id: 3, url: "https://example.com/a" }], appDomains).saveable).toEqual([
			{ url: "https://example.com/a", title: "https://example.com/a", tabId: 3 },
		]);
	});

	it("drops tabs that have no url", () => {
		expect(classifyTabs([{ url: undefined }, {}], appDomains).saveable).toEqual([]);
	});

	it("drops non-http(s) schemes (chrome://, about:, file:, moz-extension://)", () => {
		expect(
			classifyTabs(
				[
					{ url: "chrome://settings" },
					{ url: "about:blank" },
					{ url: "file:///tmp/x.html" },
					{ url: "moz-extension://abc/popup.html" },
					{ url: "https://example.com/keep", title: "Keep" },
				],
				appDomains,
			).saveable,
		).toEqual([{ url: "https://example.com/keep", title: "Keep", tabId: undefined }]);
	});

	it("drops the app's own pages, including localhost", () => {
		expect(
			classifyTabs(
				[
					{ url: "https://readplace.com/queue" },
					{ url: "http://localhost:3000/queue" },
					{ url: "https://example.com/keep", title: "Keep" },
				],
				appDomains,
			).saveable,
		).toEqual([{ url: "https://example.com/keep", title: "Keep", tabId: undefined }]);
	});

	it("matches the http(s) scheme case-insensitively", () => {
		expect(classifyTabs([{ id: 4, url: "HTTPS://example.com/a", title: "A" }], appDomains).saveable).toEqual([
			{ url: "HTTPS://example.com/a", title: "A", tabId: 4 },
		]);
	});

	it("dedupes tabs open on the same url, keeping the first seen", () => {
		expect(
			classifyTabs(
				[
					{ id: 1, url: "https://example.com/a", title: "First" },
					{ id: 2, url: "https://example.com/a", title: "Second" },
					{ id: 3, url: "https://example.com/b", title: "B" },
				],
				appDomains,
			).saveable,
		).toEqual([
			{ url: "https://example.com/a", title: "First", tabId: 1 },
			{ url: "https://example.com/b", title: "B", tabId: 3 },
		]);
	});

	it("saves a tab still mid-navigation via its pendingUrl", () => {
		expect(
			classifyTabs(
				[
					{ id: 1, url: "", pendingUrl: "https://example.com/loading", title: "Loading" },
					{ id: 2, url: "https://example.com/done", title: "Done" },
				],
				appDomains,
			).saveable,
		).toEqual([
			{ url: "https://example.com/loading", title: "Loading", tabId: 1 },
			{ url: "https://example.com/done", title: "Done", tabId: 2 },
		]);
	});

	it("applies the scheme and app-domain filters to the pendingUrl it resolved", () => {
		expect(
			classifyTabs(
				[
					{ id: 1, url: "", pendingUrl: "chrome://settings" },
					{ id: 2, url: "", pendingUrl: "https://readplace.com/queue" },
					{ id: 3, url: "", pendingUrl: "https://example.com/keep", title: "Keep" },
				],
				appDomains,
			).saveable,
		).toEqual([{ url: "https://example.com/keep", title: "Keep", tabId: 3 }]);
	});

	it("dedupes a mid-navigation tab against its committed twin", () => {
		expect(
			classifyTabs(
				[
					{ id: 1, url: "https://example.com/a", title: "Committed" },
					{ id: 2, url: "", pendingUrl: "https://example.com/a", title: "Loading" },
				],
				appDomains,
			).saveable,
		).toEqual([{ url: "https://example.com/a", title: "Committed", tabId: 1 }]);
	});

	it("names each kind of drop once, in the order the window first hit it", () => {
		expect(
			classifyTabs(
				[
					{ url: "chrome://settings" },
					{ url: "about:blank" },
					{ url: "https://readplace.com/queue" },
					{ id: 1, url: "https://example.com/a", title: "A" },
					{ id: 2, url: "https://example.com/a", title: "A again" },
					{ id: 3, url: "https://example.com/a", title: "A once more" },
				],
				appDomains,
			).skipReasons,
		).toEqual([
			"Only http and https URLs can be saved",
			"Readplace's own pages aren't saved",
			"Already open in another tab",
		]);
	});

	it("reports no reasons when every tab is saveable", () => {
		expect(
			classifyTabs([{ id: 1, url: "https://example.com/a", title: "A" }], appDomains).skipReasons,
		).toEqual([]);
	});
});

describe("saveAllTabsLabel", () => {
	it("counts every tab the window holds", () => {
		expect(saveAllTabsLabel(12)).toBe("Save 12 tabs");
	});

	it("keeps the noun singular for a lone tab", () => {
		expect(saveAllTabsLabel(1)).toBe("Save 1 tab");
	});

	it("still reads as a plural for an empty window", () => {
		expect(saveAllTabsLabel(0)).toBe("Save 0 tabs");
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
		).toBe("Saved 3 · Already in readlist 2 · Skipped 0");
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

describe("buildSaveAllDetailLines", () => {
	it("names each failed tab by its url", () => {
		expect(
			buildSaveAllDetailLines({
				failedUrls: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
				skippedUrls: [],
				clientSkipReasons: [],
			}),
		).toEqual(["Couldn't save https://example.com/a", "Couldn't save https://example.com/b"]);
	});

	it("caps the failed list and counts the rest", () => {
		const failedUrls = Array.from({ length: 7 }, (_v, i) => ({ url: `https://example.com/tab-${i}` }));
		expect(buildSaveAllDetailLines({ failedUrls, skippedUrls: [], clientSkipReasons: [] })).toEqual([
			"Couldn't save https://example.com/tab-0",
			"Couldn't save https://example.com/tab-1",
			"Couldn't save https://example.com/tab-2",
			"Couldn't save https://example.com/tab-3",
			"Couldn't save https://example.com/tab-4",
			"And 2 more failed.",
		]);
	});

	it("bullets each distinct skip reason once, merging the window's own drops with the server's", () => {
		expect(
			buildSaveAllDetailLines({
				failedUrls: [],
				skippedUrls: [
					{ url: "http://10.0.0.5/admin", code: "private_network", message: "Private-network and loopback addresses can't be saved" },
					{ url: "http://printer.local/status", code: "private_network", message: "Private-network and loopback addresses can't be saved" },
					{ url: "ftp://example.com/file", code: "unsupported_scheme", message: "Only http and https URLs can be saved" },
				],
				clientSkipReasons: ["Only http and https URLs can be saved", "Already open in another tab"],
			}),
		).toEqual([
			"• Only http and https URLs can be saved",
			"• Already open in another tab",
			"• Private-network and loopback addresses can't be saved",
		]);
	});

	it("leaves a skip without a server message out of the bullets rather than inventing a reason", () => {
		expect(
			buildSaveAllDetailLines({
				failedUrls: [],
				skippedUrls: [{ url: "https://example.com/a", code: "private_network" }],
				clientSkipReasons: [],
			}),
		).toEqual([]);
	});

	it("caps the bullets at five distinct reasons and waves at the rest", () => {
		const skippedUrls = Array.from({ length: 7 }, (_v, i) => ({
			url: `https://example.com/tab-${i}`,
			code: "malformed_url",
			message: `Reason ${i}`,
		}));
		expect(buildSaveAllDetailLines({ failedUrls: [], skippedUrls, clientSkipReasons: [] })).toEqual([
			"• Reason 0",
			"• Reason 1",
			"• Reason 2",
			"• Reason 3",
			"• Reason 4",
			"… and others",
		]);
	});

	it("lists the failures above the reason bullets", () => {
		expect(
			buildSaveAllDetailLines({
				failedUrls: [{ url: "https://example.com/a" }],
				skippedUrls: [],
				clientSkipReasons: ["Already open in another tab"],
			}),
		).toEqual(["Couldn't save https://example.com/a", "• Already open in another tab"]);
	});
});
