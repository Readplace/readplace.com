import { initInMemoryAuth } from "./auth/in-memory-auth";
import { initInMemoryReadingList } from "./reading-list/in-memory-reading-list";
import { initSaveCurrentTab } from "./save-current-tab";

describe("initSaveCurrentTab", () => {
	describe("guarded save flow after login", () => {
		it("should produce a GuardedResult-shaped response when checking an unsaved URL", async () => {
			const auth = initInMemoryAuth();
			const readingList = initInMemoryReadingList();
			await auth.login();

			const guarded = auth.whenLoggedIn(() =>
				readingList.findByUrl("https://example.com/new-article"),
			);
			const response = !guarded.ok
				? guarded
				: { ok: true as const, value: await guarded.value };

			expect(response.ok).toBe(true);
		});
	});

	it("should save a new tab URL", async () => {
		const list = initInMemoryReadingList();
		const saveCurrentTab = initSaveCurrentTab({ saveUrl: list.saveUrl });

		const result = await saveCurrentTab({
			url: "https://example.com/article",
			title: "Example Article",
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.item.url).toBe("https://example.com/article");
			expect(result.item.title).toBe("Example Article");
		}
	});

	it("should return already-saved for a duplicate tab URL", async () => {
		const list = initInMemoryReadingList();
		const saveCurrentTab = initSaveCurrentTab({ saveUrl: list.saveUrl });

		await saveCurrentTab({
			url: "https://example.com/article",
			title: "First Save",
		});

		const result = await saveCurrentTab({
			url: "https://example.com/article",
			title: "Second Save",
		});

		expect(result).toEqual({ ok: false, reason: "already-saved" });
	});
});
