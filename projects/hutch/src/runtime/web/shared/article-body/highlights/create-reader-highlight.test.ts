import assert from "node:assert/strict";
import { CandidateIdSchema, type Highlight, HighlightIdSchema } from "@packages/domain/article";
import { HIGHLIGHT_MAX_EXACT_LENGTH } from "@packages/domain/article/highlight";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryHighlights } from "@packages/test-fixtures/providers/highlights";
import { initCreateReaderHighlight } from "./create-reader-highlight";

const userId = UserIdSchema.parse("reader-1");
const url = "example.com/article";
const text = "The quick brown fox jumps over the lazy dog. A second sentence follows here.";
const contentHash = "hash-1";
const NOW = new Date("2026-11-01T10:00:00.000Z");
const ID_1 = "00000000-0000-4000-8000-000000000001";
const ID_2 = "00000000-0000-4000-8000-000000000002";
const ID_3 = "00000000-0000-4000-8000-000000000003";

function setup(ids: string[] = [ID_1, ID_2, ID_3]) {
	const store = initInMemoryHighlights();
	const queue = [...ids];
	const createReaderHighlight = initCreateReaderHighlight({
		listArticleHighlights: store.listArticleHighlights,
		createHighlight: store.createHighlight,
		newHighlightId: () => {
			const next = queue.shift();
			assert(next, "test ran out of ids");
			return next;
		},
		now: () => NOW,
	});
	return { store, createReaderHighlight };
}

function rangeOf(exact: string) {
	const start = text.indexOf(exact);
	assert.notEqual(start, -1);
	return { exact, start, end: start + exact.length };
}

function storedRow(overrides: Partial<Highlight> & { exact: string; start: number; end: number }): Highlight {
	return {
		prefix: "",
		suffix: "",
		highlightId: HighlightIdSchema.parse(ID_3),
		highlightOf: url,
		anchoredContentHash: contentHash,
		anchorState: "anchored",
		orderKey: overrides.start,
		createdAt: NOW,
		updatedAt: NOW,
		anchorRevision: 0,
		...overrides,
	};
}

describe("initCreateReaderHighlight", () => {
	it("creates a highlight re-described against the served text", async () => {
		const { store, createReaderHighlight } = setup();

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
		});

		assert.equal(outcome.status, "created");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.equal(rows.length, 1);
		const [row] = rows;
		assert.equal(row.highlightId, ID_1);
		assert.equal(row.exact, "brown fox");
		assert.equal(row.prefix, "The quick ");
		assert.equal(row.suffix, " jumps over the lazy dog. A");
		assert.equal(row.highlightOf, url);
		assert.equal(row.anchoredContentHash, contentHash);
		assert.equal(Object.hasOwn(row, "anchoredCandidateId"), false);
		assert.equal(row.anchorState, "anchored");
		assert.equal(row.orderKey, row.start);
		assert.equal(row.anchorRevision, 0);
		assert.deepEqual(row.createdAt, NOW);
		assert.deepEqual(row.updatedAt, NOW);
	});

	it("records the canonical candidate the highlight was anchored on", async () => {
		const { store, createReaderHighlight } = setup();
		const candidateId = CandidateIdSchema.parse("candidate-1");

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			candidateId,
			userId,
			url,
			...rangeOf("brown fox"),
		});

		assert.equal(outcome.status, "created");
		const [row] = await store.listArticleHighlights({ userId, url });
		assert.equal(row.anchoredCandidateId, candidateId);
	});

	it("answers passage-changed when exact is not at [start, end)", async () => {
		const { store, createReaderHighlight } = setup();

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
			exact: "brown cat",
		});

		assert.deepEqual(outcome, { status: "passage-changed" });
		assert.equal((await store.listArticleHighlights({ userId, url })).length, 0);
	});

	it("answers passage-changed for an empty selection", async () => {
		const { createReaderHighlight } = setup();

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			exact: "",
			start: 4,
			end: 4,
		});

		assert.deepEqual(outcome, { status: "passage-changed" });
	});

	it("answers too-long when exact is over the cap", async () => {
		const { createReaderHighlight } = setup();
		const long = "a".repeat(HIGHLIGHT_MAX_EXACT_LENGTH + 1);

		const outcome = await createReaderHighlight({
			text: long,
			contentHash,
			userId,
			url,
			exact: long,
			start: 0,
			end: long.length,
		});

		assert.deepEqual(outcome, { status: "too-long" });
	});

	it("answers too-long when the merged range is over the cap", async () => {
		const { store, createReaderHighlight } = setup();
		const half = HIGHLIGHT_MAX_EXACT_LENGTH - 10;
		const long = "a".repeat(HIGHLIGHT_MAX_EXACT_LENGTH + 20);
		await createReaderHighlight({
			text: long,
			contentHash,
			userId,
			url,
			exact: long.slice(0, half),
			start: 0,
			end: half,
		});

		const outcome = await createReaderHighlight({
			text: long,
			contentHash,
			userId,
			url,
			exact: long.slice(20, long.length),
			start: 20,
			end: long.length,
		});

		assert.deepEqual(outcome, { status: "too-long" });
		assert.equal((await store.listArticleHighlights({ userId, url })).length, 1);
	});

	it("merges an overlapping highlight into one row spanning both", async () => {
		const { store, createReaderHighlight } = setup();
		await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("quick brown"),
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
		});

		assert.equal(outcome.status, "merged");
		assert(outcome.status === "merged");
		assert.deepEqual(outcome.replacedIds, [ID_1]);
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.exact]),
			[[ID_2, "quick brown fox"]],
		);
	});

	it("merges a stored row where it anchors in the served text, not on its stored offsets", async () => {
		const { store, createReaderHighlight } = setup();
		const lazy = rangeOf("lazy dog");
		await store.createHighlight({
			userId,
			highlight: storedRow({
				exact: "lazy dog",
				start: lazy.start - 5,
				end: lazy.end - 5,
				anchoredContentHash: "old",
			}),
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("the lazy"),
		});

		assert.equal(outcome.status, "merged");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => row.exact),
			["the lazy dog"],
		);
	});

	it("leaves an orphaned row out of the merge", async () => {
		const { store, createReaderHighlight } = setup();
		const fox = rangeOf("brown fox");
		await store.createHighlight({
			userId,
			highlight: storedRow({
				exact: "vanished words",
				start: fox.start,
				end: fox.end,
				anchoredContentHash: "old",
			}),
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...fox,
		});

		assert.equal(outcome.status, "created");
		assert.equal((await store.listArticleHighlights({ userId, url })).length, 2);
	});

	it("passes the store's cancelled outcome through", async () => {
		const { store, createReaderHighlight } = setup();
		await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("quick brown"),
		});
		store.setCreateCancelled(true);

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
		});

		assert.deepEqual(outcome, { status: "cancelled" });
	});
});
