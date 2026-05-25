import type { ReadingListItemId } from "./domain/reading-list-item.types";
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

	it("forwards pdfBytes to saveUrl so the underlying reading list can pick the PDF tier-0 path", async () => {
		const captured: Parameters<typeof saveUrl>[0][] = [];
		const saveUrl = async (params: {
			url: string;
			title: string;
			rawHtml?: string;
			pdfBytes?: ArrayBuffer;
		}) => {
			captured.push(params);
			return { ok: true as const, item: {
				id: "x" as ReadingListItemId,
				url: params.url,
				title: params.title,
				savedAt: new Date(),
			} };
		};
		const saveCurrentTab = initSaveCurrentTab({ saveUrl });

		const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer;
		await saveCurrentTab({
			url: "https://example.com/x.pdf",
			title: "",
			pdfBytes,
		});

		expect(captured).toHaveLength(1);
		expect(captured[0]?.pdfBytes).toBe(pdfBytes);
	});
});
