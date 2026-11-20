import assert from "node:assert/strict";
import {
	CandidateIdSchema,
	HIGHLIGHT_NOTE_MAX_LENGTH,
	type Highlight,
	HighlightIdSchema,
} from "@packages/domain/article";
import { describeRange, HIGHLIGHT_MAX_EXACT_LENGTH, normaliseText } from "@packages/domain/article/highlight";
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
const ID_4 = "00000000-0000-4000-8000-000000000004";

function setup(ids: string[] = [ID_1, ID_2, ID_3, ID_4]) {
	const store = initInMemoryHighlights();
	const queue = [...ids];
	const createReaderHighlight = initCreateReaderHighlight({
		listArticleHighlights: store.listArticleHighlights,
		createHighlight: store.createHighlight,
		updateHighlightNote: store.updateHighlightNote,
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
		assert.equal(Object.hasOwn(row, "createdOnCandidateId"), false);
		assert.equal(row.anchorState, "anchored");
		assert.equal(row.orderKey, row.start);
		assert.equal(row.anchorRevision, 0);
		assert.deepEqual(row.createdAt, NOW);
		assert.deepEqual(row.updatedAt, NOW);
	});

	it("records the canonical candidate the highlight was anchored on and created on", async () => {
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
		assert.equal(row.createdOnCandidateId, candidateId);
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

	it("stores a selection over the cap as consecutive highlights within it, with the note on the last", async () => {
		const { store, createReaderHighlight } = setup();
		const paragraph = `${"word ".repeat(1499)}end.`;
		const long = Array.from({ length: 3 }, () => paragraph).join("\n");
		assert.equal(long.length > 20_000, true);

		const outcome = await createReaderHighlight({
			text: long,
			contentHash,
			userId,
			url,
			exact: long,
			start: 0,
			end: long.length,
			note: "whole chapter",
		});

		assert.equal(outcome.status, "created");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.start, row.end, row.note]),
			[
				[ID_1, 0, paragraph.length + 1, undefined],
				[ID_2, paragraph.length + 1, 2 * (paragraph.length + 1), undefined],
				[ID_3, 2 * (paragraph.length + 1), long.length, "whole chapter"],
			],
		);
		assert.equal(
			rows.map((row) => row.exact).join(""),
			long,
		);
		assert.equal(rows.every((row) => row.exact.length <= HIGHLIGHT_MAX_EXACT_LENGTH), true);
	});

	it("keeps a neighbour the merge would take past the cap, and highlights only the text it does not cover", async () => {
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

		assert.equal(outcome.status, "created");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.start, row.end]),
			[
				[ID_1, 0, half],
				[ID_2, half, long.length],
			],
		);
	});

	it("creates a highlight on each side of a neighbour inside the selection that it cannot merge", async () => {
		const { store, createReaderHighlight } = setup([ID_1, ID_2]);
		await store.createHighlight({
			userId,
			highlights: [storedRow({ ...rangeOf("fox"), note: "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 5) })],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox jumps"),
			note: "my note",
		});

		assert.equal(outcome.status, "created");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.exact, row.note?.length]),
			[
				[ID_1, "brown ", undefined],
				[ID_3, "fox", HIGHLIGHT_NOTE_MAX_LENGTH - 5],
				[ID_2, " jumps", "my note".length],
			],
		);
	});

	it("writes nothing and names the highlight for a selection already inside one", async () => {
		const { store, createReaderHighlight } = setup();
		await createReaderHighlight({ text, contentHash, userId, url, ...rangeOf("quick brown fox") });

		const outcome = await createReaderHighlight({ text, contentHash, userId, url, ...rangeOf("brown") });

		assert.equal(outcome.status, "unchanged");
		assert(outcome.status === "unchanged");
		assert.equal(outcome.highlight.highlightId, ID_1);
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.exact]),
			[[ID_1, "quick brown fox"]],
		);
	});

	it("joins the note onto the highlight a selection already lies inside", async () => {
		const { store, createReaderHighlight } = setup();
		await store.createHighlight({
			userId,
			highlights: [storedRow({ ...rangeOf("quick brown fox"), highlightId: HighlightIdSchema.parse(ID_2), note: "older note" })],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown"),
			note: "request note",
		});

		assert.equal(outcome.status, "noted");
		assert(outcome.status === "noted");
		assert.equal(outcome.highlight.highlightId, ID_2);
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.exact, row.note]),
			[[ID_2, "quick brown fox", "request note\n\nolder note"]],
		);
	});

	it("joins the note onto the last of the highlights that together cover the selection", async () => {
		const { store, createReaderHighlight } = setup();
		const long = "a".repeat(16_300);
		await store.createHighlight({
			userId,
			highlights: [
				storedRow({ exact: long.slice(0, 8150), start: 0, end: 8150, highlightId: HighlightIdSchema.parse(ID_2) }),
				storedRow({ exact: long.slice(8150), start: 8150, end: 16_300, highlightId: HighlightIdSchema.parse(ID_3) }),
			],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text: long,
			contentHash,
			userId,
			url,
			exact: long.slice(8100, 8200),
			start: 8100,
			end: 8200,
			note: "spans both",
		});

		assert.equal(outcome.status, "noted");
		assert(outcome.status === "noted");
		assert.equal(outcome.highlight.highlightId, ID_3);
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.note]),
			[
				[ID_2, undefined],
				[ID_3, "spans both"],
			],
		);
	});

	it("answers notes-too-long without writing when the note does not fit on the highlight already covering the selection", async () => {
		const { store, createReaderHighlight } = setup();
		const stored = "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 5);
		await store.createHighlight({
			userId,
			highlights: [storedRow({ ...rangeOf("quick brown fox"), note: stored })],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown"),
			note: "four",
		});

		assert.deepEqual(outcome, { status: "notes-too-long" });
		const [row] = await store.listArticleHighlights({ userId, url });
		assert.equal(row.note, stored);
	});

	it("answers cancelled when the highlight covering the selection is gone before its note is joined", async () => {
		const store = initInMemoryHighlights();
		const covering = storedRow({ ...rangeOf("quick brown fox"), note: "kept" });
		const createReaderHighlight = initCreateReaderHighlight({
			listArticleHighlights: async () => [covering],
			createHighlight: store.createHighlight,
			updateHighlightNote: store.updateHighlightNote,
			newHighlightId: () => ID_1,
			now: () => NOW,
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown"),
			note: "late note",
		});

		assert.deepEqual(outcome, { status: "cancelled" });
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
			highlights: [storedRow({
				exact: "lazy dog",
				start: lazy.start - 5,
				end: lazy.end - 5,
				anchoredContentHash: "old",
			})],
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
			highlights: [storedRow({
				exact: "vanished words",
				start: fox.start,
				end: fox.end,
				anchoredContentHash: "old",
			})],
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

	it("stores the request's note on a new highlight", async () => {
		const { store, createReaderHighlight } = setup();

		await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
			note: "my note",
		});

		const [row] = await store.listArticleHighlights({ userId, url });
		assert.equal(row.note, "my note");
	});

	it("stores no note when none is sent and none is replaced", async () => {
		const { store, createReaderHighlight } = setup();

		await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
		});

		const [row] = await store.listArticleHighlights({ userId, url });
		assert.equal(Object.hasOwn(row, "note"), false);
	});

	it("joins the request's note with the replaced rows' notes, newest first", async () => {
		const { store, createReaderHighlight } = setup([ID_1]);
		const quick = rangeOf("quick");
		const fox = rangeOf("fox");
		await store.createHighlight({
			userId,
			highlights: [storedRow({
				...quick,
				highlightId: HighlightIdSchema.parse(ID_2),
				note: "older note",
				createdAt: new Date("2026-10-01T00:00:00.000Z"),
				updatedAt: new Date("2026-10-30T00:00:00.000Z"),
			})],
			replacedIds: [],
		});
		await store.createHighlight({
			userId,
			highlights: [storedRow({
				...fox,
				highlightId: HighlightIdSchema.parse(ID_3),
				note: "newer note",
				createdAt: new Date("2026-10-15T00:00:00.000Z"),
				updatedAt: new Date("2026-10-15T00:00:00.000Z"),
			})],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("quick brown fox"),
			note: "request note",
		});

		assert.equal(outcome.status, "merged");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.note]),
			[[ID_1, "request note\n\nnewer note\n\nolder note"]],
		);
	});

	it("keeps a replaced row's note on a plain create", async () => {
		const { store, createReaderHighlight } = setup([ID_1]);
		await store.createHighlight({
			userId,
			highlights: [storedRow({ ...rangeOf("quick brown"), note: "kept note" })],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
		});

		assert.equal(outcome.status, "merged");
		const [row] = await store.listArticleHighlights({ userId, url });
		assert.equal(row.exact, "quick brown fox");
		assert.equal(row.note, "kept note");
	});

	it("leaves a neighbour whose notes would not fit separate and highlights the rest", async () => {
		const { store, createReaderHighlight } = setup([ID_1]);
		const stored = "a".repeat(HIGHLIGHT_NOTE_MAX_LENGTH - 5);
		await store.createHighlight({
			userId,
			highlights: [storedRow({ ...rangeOf("quick brown"), note: stored })],
			replacedIds: [],
		});

		const outcome = await createReaderHighlight({
			text,
			contentHash,
			userId,
			url,
			...rangeOf("brown fox"),
			note: "four",
		});

		assert.equal(outcome.status, "created");
		const rows = await store.listArticleHighlights({ userId, url });
		assert.deepEqual(
			rows.map((row) => [row.highlightId, row.exact, row.note]),
			[
				[ID_3, "quick brown", stored],
				[ID_1, " fox", "four"],
			],
		);
	});

	describe("merging only with a highlight drawn where the design places it", () => {
		const INTRO = "Intro here.";
		const OUTRO = "Outro here.";
		const MILD = "Weather was mild all week.";
		const NORTH = "Up north the old bridge was closed for repairs in autumn.";
		const NORTH_EDITED = NORTH.replace("old bridge", "old iron bridge");
		const SOUTH = "Down south the old bridge carried trains until the flood came.";
		const FOX = "Yesterday the quick brown fox jumps over the lazy dog near the old river bank.";

		function textOf(paragraphs: string[]): string {
			return normaliseText(paragraphs.map((paragraph) => ({ text: paragraph, blockBoundaryBefore: true }))).text;
		}

		function rowAt(params: { text: string; quote: string }): Highlight {
			const start = params.text.indexOf(params.quote);
			assert.notEqual(start, -1);
			return storedRow({ ...describeRange({ text: params.text, start, end: start + params.quote.length }) });
		}

		const editedText = textOf([INTRO, NORTH_EDITED, MILD, SOUTH, OUTRO]);
		const followedEdit: Highlight = {
			...rowAt({ text: editedText, quote: "the old iron bridge" }),
			exact: "the old bridge",
			basisQuote: "the old iron bridge",
			basisCandidateId: CandidateIdSchema.parse("candidate-h1"),
			anchoredContentHash: "h1",
			anchorState: "moved",
		};

		async function select(params: { text: string; contentHash: string; row: Highlight; quote: string }) {
			const { store, createReaderHighlight } = setup([ID_1]);
			await store.createHighlight({ userId, highlights: [params.row], replacedIds: [] });
			const start = params.text.indexOf(params.quote);
			assert.notEqual(start, -1);
			const outcome = await createReaderHighlight({
				text: params.text,
				contentHash: params.contentHash,
				userId,
				url,
				exact: params.quote,
				start,
				end: start + params.quote.length,
			});
			const rows = await store.listArticleHighlights({ userId, url });
			return {
				status: outcome.status,
				replaced: !rows.some((row) => row.highlightId === params.row.highlightId),
				created: rows.find((row) => row.highlightId === ID_1)?.exact,
			};
		}

		it("MG2: does not merge with the same words in another paragraph than the one the edit was followed into", async () => {
			expect(
				await select({ text: editedText, contentHash: "h1", row: followedEdit, quote: "south the old bridge carried" }),
			).toEqual({ status: "created", replaced: false, created: "south the old bridge carried" });
		});

		it("MG3: does not merge with a highlight whose passage was not found", async () => {
			const text = textOf([INTRO, MILD, SOUTH, OUTRO]);
			const notFound: Highlight = {
				...rowAt({ text: textOf([INTRO, NORTH, MILD, SOUTH, OUTRO]), quote: "the old bridge" }),
				basisCandidateId: CandidateIdSchema.parse("candidate-h1"),
				anchoredContentHash: "h1",
				anchorState: "orphaned",
			};

			expect(await select({ text, contentHash: "h1", row: notFound, quote: "old bridge carried trains" })).toEqual({
				status: "created",
				replaced: false,
				created: "old bridge carried trains",
			});
		});

		it("MG4: does not merge at a newer hash where the highlight's context no longer proves a place", async () => {
			const text = textOf([INTRO, MILD, SOUTH, OUTRO]);

			expect(await select({ text, contentHash: "h2", row: followedEdit, quote: "old bridge carried trains" })).toEqual({
				status: "created",
				replaced: false,
				created: "old bridge carried trains",
			});
		});

		it("MG5: merges with the highlight where the edit was followed", async () => {
			expect(
				await select({ text: editedText, contentHash: "h1", row: followedEdit, quote: "old iron bridge was closed" }),
			).toEqual({ status: "merged", replaced: true, created: "the old iron bridge was closed" });
		});

		it("MG6: merges with a highlight without a basis where today's pass places it, widened to whole words", async () => {
			const text = textOf([INTRO, FOX.replace("jumps", "leaps"), OUTRO]);
			const row = { ...rowAt({ text: textOf([INTRO, FOX, OUTRO]), quote: "quick brown fox jumps over the lazy dog" }), anchoredContentHash: "h0" };

			expect(await select({ text, contentHash: "h1", row, quote: "lazy dog near the old river" })).toEqual({
				status: "merged",
				replaced: true,
				created: "quick brown fox leaps over the lazy dog near the old river",
			});
		});

		it("MG6.2: does not merge a selection elsewhere with a highlight without a basis", async () => {
			const text = textOf([INTRO, FOX.replace("jumps", "leaps"), OUTRO]);
			const row = { ...rowAt({ text: textOf([INTRO, FOX, OUTRO]), quote: "quick brown fox jumps over the lazy dog" }), anchoredContentHash: "h0" };

			expect(await select({ text, contentHash: "h1", row, quote: "Outro" })).toEqual({ status: "created", replaced: false, created: "Outro" });
		});
	});
});
