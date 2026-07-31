import { initGetShortcutTarget } from "./handle-shortcut-command";

describe("initGetShortcutTarget", () => {
	it("should return target when tab has URL and title", async () => {
		const getTarget = initGetShortcutTarget({
			queryActiveTabs: async () => [
				{ url: "https://example.com/article", title: "Example Article" },
			],
		});

		const result = await getTarget();

		expect(result).toEqual({
			url: "https://example.com/article",
			title: "Example Article",
		});
	});

	it("carries the active tab so a save can mark it without asking the server", async () => {
		const getTarget = initGetShortcutTarget({
			queryActiveTabs: async () => [
				{ id: 4, url: "https://example.com/article", title: "Example Article" },
			],
		});

		const result = await getTarget();

		expect(result?.tabId).toBe(4);
	});

	it("should use URL as title when tab has no title", async () => {
		const getTarget = initGetShortcutTarget({
			queryActiveTabs: async () => [{ url: "https://example.com/no-title" }],
		});

		const result = await getTarget();

		expect(result).toEqual({
			url: "https://example.com/no-title",
			title: "https://example.com/no-title",
		});
	});

	it("should return null when no active tab exists", async () => {
		const getTarget = initGetShortcutTarget({
			queryActiveTabs: async () => [],
		});

		const result = await getTarget();

		expect(result).toBeNull();
	});

	it("should return null when tab has no URL", async () => {
		const getTarget = initGetShortcutTarget({
			queryActiveTabs: async () => [{}],
		});

		const result = await getTarget();

		expect(result).toBeNull();
	});
});
