import assert from "node:assert/strict";
import { type Highlight, type HighlightId, HighlightIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryHighlights } from "./in-memory-highlights";

const USER = UserIdSchema.parse("00000000000000000000000000000001");
const OTHER_USER = UserIdSchema.parse("00000000000000000000000000000002");
const ARTICLE = "example.com/x";
const NESTED_ARTICLE = "example.com/x/y";

let idCounter = 0;
function nextId(): HighlightId {
	idCounter += 1;
	return HighlightIdSchema.parse(`00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`);
}

function aHighlight(overrides: Partial<Highlight> = {}): Highlight {
	return {
		highlightId: nextId(),
		highlightOf: ARTICLE,
		exact: "a passage",
		prefix: "",
		suffix: "",
		start: 0,
		end: 9,
		anchoredContentHash: "hash-1",
		anchorState: "anchored",
		orderKey: 0,
		createdAt: new Date("2026-11-01T10:00:00.000Z"),
		updatedAt: new Date("2026-11-01T10:00:00.000Z"),
		anchorRevision: 0,
		...overrides,
	};
}

describe("initInMemoryHighlights", () => {
	it("creates and lists an article's highlights in orderKey order, then by id", async () => {
		const store = initInMemoryHighlights();
		const late = aHighlight({ orderKey: 9 });
		const earlyA = aHighlight({ orderKey: 1 });
		const earlyB = aHighlight({ orderKey: 1 });
		for (const highlight of [late, earlyB, earlyA]) {
			assert.deepEqual(await store.createHighlight({ userId: USER, highlight, replacedIds: [] }), {
				status: "created",
				highlight,
				replacedIds: [],
			});
		}

		const listed = await store.listArticleHighlights({ userId: USER, url: ARTICLE });

		assert.deepEqual(listed, [earlyA, earlyB, late]);
	});

	it("keeps /x and /x/y and each reader apart", async () => {
		const store = initInMemoryHighlights();
		const onX = aHighlight();
		const onNested = aHighlight({ highlightOf: NESTED_ARTICLE });
		await store.createHighlight({ userId: USER, highlight: onX, replacedIds: [] });
		await store.createHighlight({ userId: USER, highlight: onNested, replacedIds: [] });

		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [onX]);
		assert.deepEqual(await store.listArticleHighlights({ userId: OTHER_USER, url: ARTICLE }), []);
	});

	it("merges by replacing the named rows", async () => {
		const store = initInMemoryHighlights();
		const first = aHighlight();
		await store.createHighlight({ userId: USER, highlight: first, replacedIds: [] });
		const merged = aHighlight({ end: 20 });

		const outcome = await store.createHighlight({ userId: USER, highlight: merged, replacedIds: [first.highlightId] });

		assert.deepEqual(outcome, { status: "merged", highlight: merged, replacedIds: [first.highlightId] });
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [merged]);
	});

	it("cancels a merge whose replaced row is already gone, or a create whose id is taken", async () => {
		const store = initInMemoryHighlights();
		const existing = aHighlight();
		await store.createHighlight({ userId: USER, highlight: existing, replacedIds: [] });

		assert.deepEqual(await store.createHighlight({ userId: USER, highlight: aHighlight(), replacedIds: [nextId()] }), {
			status: "cancelled",
		});
		assert.deepEqual(await store.createHighlight({ userId: USER, highlight: existing, replacedIds: [] }), {
			status: "cancelled",
		});
	});

	it("answers cancelled while set to, and writes again once unset", async () => {
		const store = initInMemoryHighlights();
		store.setCreateCancelled(true);

		assert.deepEqual(await store.createHighlight({ userId: USER, highlight: aHighlight(), replacedIds: [] }), {
			status: "cancelled",
		});
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), []);

		store.setCreateCancelled(false);
		const highlight = aHighlight();
		assert.equal((await store.createHighlight({ userId: USER, highlight, replacedIds: [] })).status, "created");
	});

	it("bumps a stored row's anchorRevision by one under the same id", async () => {
		const store = initInMemoryHighlights();
		const highlight = aHighlight({ anchorRevision: 3 });
		await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

		store.bumpAnchorRevision({ userId: USER, url: ARTICLE, highlightId: highlight.highlightId });

		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), [
			{ ...highlight, anchorRevision: 4 },
		]);
		assert.throws(() => store.bumpAnchorRevision({ userId: USER, url: ARTICLE, highlightId: nextId() }));
	});

	it("deletes one highlight and reports whether it existed", async () => {
		const store = initInMemoryHighlights();
		const highlight = aHighlight();
		await store.createHighlight({ userId: USER, highlight, replacedIds: [] });

		assert.deepEqual(await store.deleteHighlight({ userId: USER, url: ARTICLE, highlightId: highlight.highlightId }), {
			deleted: true,
		});
		assert.deepEqual(await store.deleteHighlight({ userId: USER, url: ARTICLE, highlightId: highlight.highlightId }), {
			deleted: false,
		});
	});

	it("deleteArticleHighlights of /x leaves /x/y's rows", async () => {
		const store = initInMemoryHighlights();
		const onNested = aHighlight({ highlightOf: NESTED_ARTICLE });
		await store.createHighlight({ userId: USER, highlight: aHighlight(), replacedIds: [] });
		await store.createHighlight({ userId: USER, highlight: onNested, replacedIds: [] });

		await store.deleteArticleHighlights({ userId: USER, url: ARTICLE });

		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), []);
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: NESTED_ARTICLE }), [onNested]);
	});

	it("deleteAllUserHighlights removes only that reader's rows", async () => {
		const store = initInMemoryHighlights();
		const others = aHighlight();
		await store.createHighlight({ userId: USER, highlight: aHighlight(), replacedIds: [] });
		await store.createHighlight({ userId: USER, highlight: aHighlight({ highlightOf: NESTED_ARTICLE }), replacedIds: [] });
		await store.createHighlight({ userId: OTHER_USER, highlight: others, replacedIds: [] });

		await store.deleteAllUserHighlights(USER);

		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: ARTICLE }), []);
		assert.deepEqual(await store.listArticleHighlights({ userId: USER, url: NESTED_ARTICLE }), []);
		assert.deepEqual(await store.listArticleHighlights({ userId: OTHER_USER, url: ARTICLE }), [others]);
	});
});
