import { initInMemoryAuth } from "./auth/in-memory-auth";
import { initInMemoryReadingList } from "./reading-list/in-memory-reading-list";
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
		showDefault: async (tabId) => {
			calls.push({ method: "showDefault", tabId });
		},
	};
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
