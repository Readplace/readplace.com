import assert from "node:assert/strict";
import { ReaderArticleHashId } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryHighlightsStore } from "./in-memory-highlights-store";

const ALICE = UserIdSchema.parse("a".repeat(32));
const BOB = UserIdSchema.parse("b".repeat(32));
const ARTICLE = ReaderArticleHashId.from("https://example.com/post");
const OTHER_ARTICLE = ReaderArticleHashId.from("https://example.com/other");

function clock(start: number): () => Date {
	let tick = start;
	return () => new Date(tick++);
}

describe("initInMemoryHighlightsStore", () => {
	it("creates a highlight and reads it back for the owning user and article", async () => {
		const store = initInMemoryHighlightsStore({ now: () => new Date("2026-01-01T00:00:00Z") });

		const created = await store.createHighlight({
			userId: ALICE,
			articleId: ARTICLE,
			quote: "a memorable sentence",
			note: "why it matters",
		});

		const found = await store.findHighlightsByArticle({ userId: ALICE, articleId: ARTICLE });
		expect(found).toHaveLength(1);
		expect(found[0].id).toBe(created.id);
		expect(found[0].quote).toBe("a memorable sentence");
		expect(found[0].note).toBe("why it matters");
	});

	it("returns highlights ordered oldest-first by creation time", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(1000) });

		const first = await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "one", note: "" });
		const second = await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "two", note: "" });

		const found = await store.findHighlightsByArticle({ userId: ALICE, articleId: ARTICLE });
		expect(found.map((h) => h.id)).toEqual([first.id, second.id]);
	});

	it("scopes highlights to the owning user", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(0) });
		await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "alice", note: "" });

		const bobsHighlights = await store.findHighlightsByArticle({ userId: BOB, articleId: ARTICLE });
		expect(bobsHighlights).toEqual([]);
	});

	it("scopes highlights to a single article", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(0) });
		await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "here", note: "" });

		const otherArticle = await store.findHighlightsByArticle({ userId: ALICE, articleId: OTHER_ARTICLE });
		expect(otherArticle).toEqual([]);
	});

	it("deletes a highlight owned by the user", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(0) });
		const created = await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "gone", note: "" });

		const deleted = await store.deleteHighlight({ userId: ALICE, articleId: ARTICLE, id: created.id });
		expect(deleted).toBe(true);
		expect(await store.findHighlightsByArticle({ userId: ALICE, articleId: ARTICLE })).toEqual([]);
	});

	it("refuses to delete an unknown highlight", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(0) });
		const created = await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "x", note: "" });

		const unknownId = `${created.id}f`;
		const HighlightIdSchema = (await import("@packages/domain/highlight")).HighlightIdSchema;
		const deleted = await store.deleteHighlight({
			userId: ALICE,
			articleId: ARTICLE,
			id: HighlightIdSchema.parse(unknownId),
		});
		expect(deleted).toBe(false);
	});

	it("refuses to delete a highlight owned by a different user", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(0) });
		const created = await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "x", note: "" });

		const deleted = await store.deleteHighlight({ userId: BOB, articleId: ARTICLE, id: created.id });
		expect(deleted).toBe(false);
		assert.equal((await store.findHighlightsByArticle({ userId: ALICE, articleId: ARTICLE })).length, 1);
	});

	it("refuses to delete when the article does not match the stored highlight", async () => {
		const store = initInMemoryHighlightsStore({ now: clock(0) });
		const created = await store.createHighlight({ userId: ALICE, articleId: ARTICLE, quote: "x", note: "" });

		const deleted = await store.deleteHighlight({ userId: ALICE, articleId: OTHER_ARTICLE, id: created.id });
		expect(deleted).toBe(false);
	});
});
