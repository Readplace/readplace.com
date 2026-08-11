import { bulkSaveNotification } from "./bulk-save-notification";

describe("bulkSaveNotification", () => {
	it("reports the same counts the popup shows, so both surfaces cannot disagree", () => {
		expect(
			bulkSaveNotification({
				outcome: {
					ok: true,
					value: { saved: 8, skipped: 1, failed: 0, tooBig: [], skippedUrls: [], failedUrls: [], alreadySaved: 0, pendingRetry: 0, unauthorized: false },
				},
				tabCount: 11,
				saveableCount: 9,
			}),
		).toEqual({ title: "Tabs saved", message: "Saved 8 · Skipped 3" });
	});

	it("carries the oversized pages onto their own line", () => {
		const notification = bulkSaveNotification({
			outcome: {
				ok: true,
				value: {
					saved: 2,
					skipped: 0,
					failed: 0,
					tooBig: [{ url: "https://example.com/huge", mb: 7 }],
					skippedUrls: [],
					failedUrls: [],
					alreadySaved: 0,
					pendingRetry: 0,
					unauthorized: false,
				},
			},
			tabCount: 2,
			saveableCount: 2,
		});

		expect(notification.message).toBe(
			"Saved 2 · Skipped 0\nSome pages were too large to capture in full (saved as links): https://example.com/huge (7 MB)",
		);
	});

	it("names signing in as what to do when the session is gone", () => {
		expect(
			bulkSaveNotification({
				outcome: { ok: false, reason: "not-logged-in" },
				tabCount: 3,
				saveableCount: 3,
			}),
		).toEqual({
			title: "Not signed in",
			message: "Sign in to Readplace to save your tabs.",
		});
	});

	it("reports the partial progress and names signing in when the session died mid-save", () => {
		expect(
			bulkSaveNotification({
				outcome: {
					ok: true,
					value: {
						saved: 40,
						skipped: 0,
						failed: 60,
						tooBig: [],
						skippedUrls: [],
						failedUrls: [{ url: "https://example.com/tab-40" }],
						alreadySaved: 0,
						pendingRetry: 0,
						unauthorized: true,
					},
				},
				tabCount: 100,
				saveableCount: 100,
			}),
		).toEqual({
			title: "Not signed in",
			message: "Saved 40 · Skipped 0 · Failed 60\nSign in to Readplace to save the rest.",
		});
	});

	it("keeps the too-big warning when the session died after pages were downgraded", () => {
		expect(
			bulkSaveNotification({
				outcome: {
					ok: true,
					value: {
						saved: 10,
						skipped: 0,
						failed: 10,
						tooBig: [{ url: "https://example.com/huge", mb: 7 }],
						skippedUrls: [],
						failedUrls: [],
						alreadySaved: 0,
						pendingRetry: 0,
						unauthorized: true,
					},
				},
				tabCount: 20,
				saveableCount: 20,
			}).message,
		).toBe(
			"Saved 10 · Skipped 0 · Failed 10\nSome pages were too large to capture in full (saved as links): https://example.com/huge (7 MB)\nSign in to Readplace to save the rest.",
		);
	});

	it("falls back to the generic failure when the save itself errored", () => {
		expect(
			bulkSaveNotification({
				outcome: { ok: false, reason: "error", error: new Error("boom") },
				tabCount: 3,
				saveableCount: 3,
			}),
		).toEqual({
			title: "Couldn't save tabs",
			message: "Something went wrong. Please try again.",
		});
	});
});
