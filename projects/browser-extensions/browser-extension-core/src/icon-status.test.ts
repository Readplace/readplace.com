import { initInMemoryAuth } from "./auth/in-memory-auth";
import { initInMemoryReadingList } from "./reading-list/in-memory-reading-list";
import { ReadingListItemIdSchema } from "./domain/reading-list-item-id";
import type { FindByUrl } from "./reading-list/reading-list.types";
import type { SetIcon } from "./icon-status";
import { initIconStatus } from "./icon-status";

function createRecordingSetIcon(): SetIcon & {
	calls: { method: string; tabId: number }[];
} {
	const calls: { method: string; tabId: number }[] = [];
	return {
		calls,
		showSaved: async (tabId) => {
			calls.push({ method: "showSaved", tabId });
		},
		showNeedsCapture: async (tabId) => {
			calls.push({ method: "showNeedsCapture", tabId });
		},
		showDefault: async (tabId) => {
			calls.push({ method: "showDefault", tabId });
		},
	};
}

function findingSavedItem(needsBrowserCapture: boolean): FindByUrl {
	return async (url) => ({
		id: ReadingListItemIdSchema.parse("saved-1"),
		url,
		title: "Saved Page",
		savedAt: new Date(0),
		actions: [],
		links: [],
		needsBrowserCapture,
	});
}

describe("initIconStatus", () => {
	it("should show default icon when not logged in", async () => {
		const auth = initInMemoryAuth();
		const readingList = initInMemoryReadingList();
		const setIcon = createRecordingSetIcon();

		const { updateIconForTab } = initIconStatus({
			findByUrl: readingList.findByUrl,
			whenLoggedIn: auth.whenLoggedIn,
			setIcon,
		});

		await updateIconForTab(1, "https://example.com");

		expect(setIcon.calls).toEqual([{ method: "showDefault", tabId: 1 }]);
	});

	it("should show default icon when URL is not saved", async () => {
		const auth = initInMemoryAuth();
		const readingList = initInMemoryReadingList();
		const setIcon = createRecordingSetIcon();
		await auth.login();

		const { updateIconForTab } = initIconStatus({
			findByUrl: readingList.findByUrl,
			whenLoggedIn: auth.whenLoggedIn,
			setIcon,
		});

		await updateIconForTab(1, "https://example.com/unsaved");

		expect(setIcon.calls).toEqual([{ method: "showDefault", tabId: 1 }]);
	});

	it("should show saved icon when URL is saved", async () => {
		const auth = initInMemoryAuth();
		const readingList = initInMemoryReadingList();
		const setIcon = createRecordingSetIcon();
		await auth.login();
		await readingList.saveUrl({
			url: "https://example.com/saved",
			title: "Saved Page",
		});

		const { updateIconForTab } = initIconStatus({
			findByUrl: readingList.findByUrl,
			whenLoggedIn: auth.whenLoggedIn,
			setIcon,
		});

		await updateIconForTab(42, "https://example.com/saved");

		expect(setIcon.calls).toEqual([{ method: "showSaved", tabId: 42 }]);
	});

	it("should show the needs-capture icon when the saved URL still needs a browser capture", async () => {
		const auth = initInMemoryAuth();
		const setIcon = createRecordingSetIcon();
		await auth.login();

		const { updateIconForTab } = initIconStatus({
			findByUrl: findingSavedItem(true),
			whenLoggedIn: auth.whenLoggedIn,
			setIcon,
		});

		await updateIconForTab(7, "https://blocked.example/article");

		expect(setIcon.calls).toEqual([{ method: "showNeedsCapture", tabId: 7 }]);
	});

	it("should show the saved icon when the saved URL needs no browser capture", async () => {
		const auth = initInMemoryAuth();
		const setIcon = createRecordingSetIcon();
		await auth.login();

		const { updateIconForTab } = initIconStatus({
			findByUrl: findingSavedItem(false),
			whenLoggedIn: auth.whenLoggedIn,
			setIcon,
		});

		await updateIconForTab(7, "https://blocked.example/article");

		expect(setIcon.calls).toEqual([{ method: "showSaved", tabId: 7 }]);
	});

	it("should use correct tabId for each call", async () => {
		const auth = initInMemoryAuth();
		const readingList = initInMemoryReadingList();
		const setIcon = createRecordingSetIcon();
		await auth.login();
		await readingList.saveUrl({
			url: "https://example.com/saved",
			title: "Saved",
		});

		const { updateIconForTab } = initIconStatus({
			findByUrl: readingList.findByUrl,
			whenLoggedIn: auth.whenLoggedIn,
			setIcon,
		});

		await updateIconForTab(10, "https://example.com/saved");
		await updateIconForTab(20, "https://example.com/not-saved");

		expect(setIcon.calls).toEqual([
			{ method: "showSaved", tabId: 10 },
			{ method: "showDefault", tabId: 20 },
		]);
	});
});
