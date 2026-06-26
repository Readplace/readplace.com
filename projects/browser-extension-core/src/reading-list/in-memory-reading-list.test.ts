import type { ReadingListItemId } from "../domain/reading-list-item.types";
import { initInMemoryReadingList } from "./in-memory-reading-list";

describe("initInMemoryReadingList", () => {
	describe("saveUrl + findByUrl", () => {
		it("should save and retrieve by URL", async () => {
			const list = initInMemoryReadingList();
			const result = await list.saveUrl({
				url: "https://example.com/article",
				title: "Example Article",
			});

			expect(result.ok).toBe(true);
			if (!result.ok) return;

			const found = await list.findByUrl("https://example.com/article");
			expect(found?.url).toBe("https://example.com/article");
			expect(found?.title).toBe("Example Article");
			expect(found?.id).toBe(result.item.id);
		});

		it("should return null for URL not in list", async () => {
			const list = initInMemoryReadingList();

			const found = await list.findByUrl("https://example.com/missing");

			expect(found).toBeNull();
		});
	});

	describe("saveUrl duplicate rejection", () => {
		it("should reject saving the same URL twice", async () => {
			const list = initInMemoryReadingList();
			await list.saveUrl({ url: "https://example.com/article", title: "First Save" });

			const result = await list.saveUrl({
				url: "https://example.com/article",
				title: "Second Save",
			});

			expect(result).toEqual({ ok: false, reason: "already-saved" });
		});
	});

	describe("invokeAction", () => {
		it("invokes the advertised delete action and returns remaining items", async () => {
			const list = initInMemoryReadingList();
			const saveResult = await list.saveUrl({
				url: "https://example.com/article",
				title: "Example",
			});
			if (!saveResult.ok) throw new Error("Save failed");

			const result = await list.invokeAction({
				id: saveResult.item.id,
				name: "delete",
			});

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.items).toEqual([]);
		});

		it("returns not-found for an unknown item id", async () => {
			const list = initInMemoryReadingList();

			const result = await list.invokeAction({
				id: "nonexistent-id" as ReadingListItemId,
				name: "delete",
			});

			expect(result).toEqual({ ok: false, reason: "not-found" });
		});

		it("leaves the item in the list when a non-removing advertised action is invoked", async () => {
			const list = initInMemoryReadingList();
			const saveResult = await list.saveUrl({
				url: "https://example.com/article",
				title: "Example",
			});
			if (!saveResult.ok) throw new Error("Save failed");

			const result = await list.invokeAction({
				id: saveResult.item.id,
				name: "update-status",
			});

			expect(result.ok).toBe(true);
			if (result.ok) expect(result.items.map((i) => i.id)).toEqual([
				saveResult.item.id,
			]);
		});

		it("returns not-found for an action the item never advertised", async () => {
			const list = initInMemoryReadingList();
			const saveResult = await list.saveUrl({
				url: "https://example.com/article",
				title: "Example",
			});
			if (!saveResult.ok) throw new Error("Save failed");

			const result = await list.invokeAction({
				id: saveResult.item.id,
				name: "mark-read",
			});

			expect(result).toEqual({ ok: false, reason: "not-found" });
		});
	});

	describe("getAllItems", () => {
		it("should return empty array when no items saved", async () => {
			const list = initInMemoryReadingList();

			const items = await list.getAllItems();

			expect(items).toEqual([]);
		});

		it("should return all saved items with their URLs", async () => {
			const list = initInMemoryReadingList();
			await list.saveUrl({ url: "https://example.com/a", title: "Article A" });
			await list.saveUrl({ url: "https://example.com/b", title: "Article B" });

			const items = await list.getAllItems();

			const urls = items.map((item) => item.url);
			expect(urls).toEqual([
				"https://example.com/a",
				"https://example.com/b",
			]);
		});

		it("should reflect newly saved items on subsequent calls", async () => {
			const list = initInMemoryReadingList();
			await list.saveUrl({
				url: "https://example.com/first",
				title: "First",
			});

			const beforeReload = await list.getAllItems();
			expect(beforeReload.map((i) => i.url)).toEqual([
				"https://example.com/first",
			]);

			await list.saveUrl({
				url: "https://example.com/second",
				title: "Second",
			});

			const afterReload = await list.getAllItems();
			expect(afterReload.map((i) => i.url)).toEqual([
				"https://example.com/first",
				"https://example.com/second",
			]);
		});
	});
});
