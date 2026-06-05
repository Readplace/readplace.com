import { UserIdSchema } from "@packages/domain/user";
import { HighlightIdSchema } from "@packages/domain/highlight";
import type { HighlightAnchor } from "@packages/domain/highlight";
import { initInMemoryHighlight } from "./in-memory-highlight";

const unknownHighlightId = HighlightIdSchema.parse(
	"99999999999999999999999999999999",
);

const userId = UserIdSchema.parse("00000000000000000000000000000001");
const otherUserId = UserIdSchema.parse("00000000000000000000000000000002");
const articleId = "0123456789abcdef0123456789abcdef";
const otherArticleId = "fedcba9876543210fedcba9876543210";

function anchor(overrides: Partial<HighlightAnchor> = {}): HighlightAnchor {
	return { start: 0, end: 5, quote: "hello", ...overrides };
}

/** Monotonic clock so createdAt values are distinct and ordering is testable. */
function tickingClock(start = Date.parse("2026-06-05T00:00:00Z")): () => Date {
	let ms = start;
	return () => {
		ms += 1000;
		return new Date(ms);
	};
}

describe("initInMemoryHighlight", () => {
	it("saves a highlight and returns it with a generated id and timestamp", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });

		const saved = await store.saveHighlight({
			userId,
			articleId,
			anchor: anchor(),
			note: "a note",
		});

		expect(saved.id).toMatch(/^[a-f0-9]{32}$/);
		expect(saved.userId).toBe(userId);
		expect(saved.articleId).toBe(articleId);
		expect(saved.anchor).toEqual(anchor());
		expect(saved.note).toBe("a note");
		expect(saved.createdAt).toBe("2026-06-05T00:00:01.000Z");
	});

	it("returns highlights for an article ordered by creation time", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });

		const first = await store.saveHighlight({ userId, articleId, anchor: anchor() });
		const second = await store.saveHighlight({
			userId,
			articleId,
			anchor: anchor({ start: 10, end: 15, quote: "world" }),
		});

		const found = await store.findHighlightsByArticle({ userId, articleId });
		expect(found.map((h) => h.id)).toEqual([first.id, second.id]);
	});

	it("returns an empty list for an article with no highlights", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		expect(await store.findHighlightsByArticle({ userId, articleId })).toEqual([]);
	});

	it("scopes highlights by user and by article", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		await store.saveHighlight({ userId, articleId, anchor: anchor() });

		expect(
			await store.findHighlightsByArticle({ userId: otherUserId, articleId }),
		).toEqual([]);
		expect(
			await store.findHighlightsByArticle({ userId, articleId: otherArticleId }),
		).toEqual([]);
	});

	it("updates the note on a highlight", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		const saved = await store.saveHighlight({ userId, articleId, anchor: anchor() });

		await store.updateHighlightNote({ id: saved.id, userId, articleId, note: "edited" });

		const [updated] = await store.findHighlightsByArticle({ userId, articleId });
		expect(updated.note).toBe("edited");
	});

	it("clears the note when the new note is blank", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		const saved = await store.saveHighlight({
			userId,
			articleId,
			anchor: anchor(),
			note: "to be cleared",
		});

		await store.updateHighlightNote({ id: saved.id, userId, articleId, note: "   " });

		const [updated] = await store.findHighlightsByArticle({ userId, articleId });
		expect(updated.note).toBeUndefined();
	});

	it("ignores a note update for an unknown article or highlight id", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		const saved = await store.saveHighlight({ userId, articleId, anchor: anchor() });

		await store.updateHighlightNote({
			id: saved.id,
			userId,
			articleId: otherArticleId,
			note: "nope",
		});
		await store.updateHighlightNote({
			id: unknownHighlightId,
			userId,
			articleId,
			note: "nope",
		});

		const [unchanged] = await store.findHighlightsByArticle({ userId, articleId });
		expect(unchanged.note).toBeUndefined();
	});

	it("deletes a highlight", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		const saved = await store.saveHighlight({ userId, articleId, anchor: anchor() });

		await store.deleteHighlight({ id: saved.id, userId, articleId });

		expect(await store.findHighlightsByArticle({ userId, articleId })).toEqual([]);
	});

	it("ignores a delete for an unknown article or highlight id", async () => {
		const store = initInMemoryHighlight({ now: tickingClock() });
		const saved = await store.saveHighlight({ userId, articleId, anchor: anchor() });

		await store.deleteHighlight({ id: saved.id, userId, articleId: otherArticleId });
		await store.deleteHighlight({ id: unknownHighlightId, userId, articleId });

		expect(await store.findHighlightsByArticle({ userId, articleId })).toHaveLength(1);
	});
});
