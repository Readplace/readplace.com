import assert from "node:assert/strict";
import { VIEW_HIGHLIGHT_LIMIT } from "@packages/domain/article/highlight";
import { initLocalHighlights, LOCAL_HIGHLIGHTS_KEY, type LocalHighlightStorage } from "./local-highlights";

const ARTICLE_URL = "https://example.com/post";

const ARTICLE_TEXT =
	"The first paragraph opens the article. A second sentence follows it closely.\nThe second paragraph has more words than the first one does. It closes the article.";

function mapStorage(): LocalHighlightStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

function throwingStorage(): LocalHighlightStorage {
	return {
		getItem: () => null,
		setItem: () => {
			throw new Error("QuotaExceededError");
		},
		removeItem: () => undefined,
	};
}

function storeOn(storage: LocalHighlightStorage) {
	let counter = 0;
	let clock = Date.parse("2026-11-14T00:00:00.000Z");
	return initLocalHighlights({
		storage,
		now: () => {
			clock += 1000;
			return new Date(clock);
		},
		newId: () => `local-${++counter}`,
	});
}

function rangeOf(quote: string): { start: number; end: number } {
	const start = ARTICLE_TEXT.indexOf(quote);
	assert.ok(start >= 0, `the fixture text contains "${quote}"`);
	return { start, end: start + quote.length };
}

describe("initLocalHighlights", () => {
	it("keeps a highlight with the text around it as its context", () => {
		const store = storeOn(mapStorage());

		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("A second sentence") });

		assert.equal(outcome.status, "kept");
		assert.deepEqual(store.all(), [
			{
				id: "local-1",
				url: ARTICLE_URL,
				exact: "A second sentence",
				prefix: "paragraph opens the article. ",
				suffix: " follows it closely.\nThe second",
				start: rangeOf("A second sentence").start,
				end: rangeOf("A second sentence").end,
				createdAt: "2026-11-14T00:00:01.000Z",
			},
		]);
	});

	it("reads back what an earlier page load kept in the same storage", () => {
		const storage = mapStorage();
		storeOn(storage).add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("first paragraph"), note: "  Remember  " });

		const reloaded = storeOn(storage);

		assert.deepEqual(
			reloaded.all().map((item) => ({ exact: item.exact, note: item.note })),
			[{ exact: "first paragraph", note: "Remember" }],
		);
	});

	it("merges a selection that overlaps a kept highlight and joins their notes, newest first", () => {
		const store = storeOn(mapStorage());
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("first paragraph opens"), note: "Older" });

		const outcome = store.add({
			url: ARTICLE_URL,
			text: ARTICLE_TEXT,
			...rangeOf("opens the article"),
			note: "Newer",
		});

		assert.equal(outcome.status, "kept");
		assert.deepEqual(
			store.all().map((item) => ({ exact: item.exact, note: item.note })),
			[{ exact: "first paragraph opens the article", note: "Newer\n\nOlder" }],
		);
	});

	it(`refuses the highlight after the ${VIEW_HIGHLIGHT_LIMIT}th and keeps the ones it has`, () => {
		const store = storeOn(mapStorage());
		const quotes = ["The first", "paragraph opens", "A second", "follows it", "more words"];
		for (const quote of quotes) {
			assert.equal(store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf(quote) }).status, "kept");
		}

		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("closes the article") });

		assert.deepEqual(outcome, { status: "limit-reached" });
		assert.deepEqual(
			store.all().map((item) => item.exact),
			quotes,
		);
	});

	it("counts the limit across every article kept in this browser", () => {
		const store = storeOn(mapStorage());
		for (const index of [1, 2, 3, 4, 5]) {
			store.add({ url: `https://example.com/post-${index}`, text: ARTICLE_TEXT, ...rangeOf("The first") });
		}

		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first") });

		assert.deepEqual(outcome, { status: "limit-reached" });
	});

	it("frees a place when a kept highlight is deleted", () => {
		const store = storeOn(mapStorage());
		for (const quote of ["The first", "paragraph opens", "A second", "follows it", "more words"]) {
			store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf(quote) });
		}

		store.remove("local-1");
		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("closes the article") });

		assert.equal(outcome.status, "kept");
	});

	it("refuses a quote longer than a kept highlight may be", () => {
		const longText = "word ".repeat(400).trim();
		const store = storeOn(mapStorage());

		const outcome = store.add({ url: ARTICLE_URL, text: longText, start: 0, end: longText.length });

		assert.deepEqual(outcome, { status: "too-long" });
		assert.deepEqual(store.all(), []);
	});

	it("refuses a note longer than a kept note may be", () => {
		const store = storeOn(mapStorage());

		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first"), note: "n".repeat(1001) });

		assert.deepEqual(outcome, { status: "too-long" });
	});

	it("refuses a range that falls outside the text", () => {
		const store = storeOn(mapStorage());

		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, start: 5, end: ARTICLE_TEXT.length + 1 });

		assert.deepEqual(outcome, { status: "passage-changed" });
	});

	it("reads a corrupt stored value as empty", () => {
		const storage = mapStorage();
		storage.values.set(LOCAL_HIGHLIGHTS_KEY, "{not json");

		assert.deepEqual(storeOn(storage).all(), []);
	});

	it("reads a stored value of another shape as empty", () => {
		const storage = mapStorage();
		storage.values.set(LOCAL_HIGHLIGHTS_KEY, JSON.stringify({ version: 1, items: [{ id: 3 }] }));

		assert.deepEqual(storeOn(storage).all(), []);
	});

	it("reads a stored list holding a null as empty", () => {
		const storage = mapStorage();
		storage.values.set(LOCAL_HIGHLIGHTS_KEY, JSON.stringify({ version: 1, items: [null] }));

		assert.deepEqual(storeOn(storage).all(), []);
	});

	it("reads a stored value of another version as empty", () => {
		const storage = mapStorage();
		storage.values.set(LOCAL_HIGHLIGHTS_KEY, JSON.stringify({ version: 2, items: [] }));

		assert.deepEqual(storeOn(storage).all(), []);
	});

	it("reports the storage unavailable when a write throws", () => {
		const store = storeOn(throwingStorage());

		assert.equal(store.isAvailable(), false);
		assert.deepEqual(store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first") }), {
			status: "unavailable",
		});
	});

	it("reports the storage available when a write succeeds", () => {
		const storage = mapStorage();

		assert.equal(storeOn(storage).isAvailable(), true);
		assert.deepEqual([...storage.values.keys()], []);
	});

	it("reads every kept highlight as empty when a read throws", () => {
		const store = initLocalHighlights({
			storage: {
				getItem: () => {
					throw new Error("SecurityError");
				},
				setItem: () => undefined,
				removeItem: () => undefined,
			},
			now: () => new Date(0),
			newId: () => "local-1",
		});

		assert.deepEqual(store.all(), []);
	});

	it("anchors a kept highlight where its quote now sits", () => {
		const store = storeOn(mapStorage());
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("A second sentence") });
		const shifted = `An added opening line.\n${ARTICLE_TEXT}`;

		const [state] = store.anchorsOn({ url: ARTICLE_URL, text: shifted });

		assert.equal(state.anchor.anchorState, "moved");
		assert.equal(shifted.slice(state.anchor.start, state.anchor.end), "A second sentence");
	});

	it("leaves a kept highlight orphaned when its quote is gone", () => {
		const store = storeOn(mapStorage());
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("A second sentence") });

		const [state] = store.anchorsOn({ url: ARTICLE_URL, text: "A different article altogether." });

		assert.equal(state.anchor.anchorState, "orphaned");
	});

	it("keeps a highlight whose quote has gone apart from a new one, without merging them", () => {
		const store = storeOn(mapStorage());
		store.add({ url: ARTICLE_URL, text: "An older version of the article.", start: 3, end: 15 });

		const outcome = store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first") });

		assert.equal(outcome.status, "kept");
		assert.deepEqual(
			store.all().map((item) => item.exact),
			["older versio", "The first"],
		);
	});

	it("changes only the note of the highlight it names", () => {
		const store = storeOn(mapStorage());
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first"), note: "First" });
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("A second"), note: "Second" });

		store.setNote({ id: "local-2", note: "Changed" });

		assert.deepEqual(
			store.all().map((item) => item.note),
			["First", "Changed"],
		);
	});

	it("sets, changes and clears a kept highlight's note", () => {
		const store = storeOn(mapStorage());
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first") });

		assert.deepEqual(store.setNote({ id: "local-1", note: "Added" }), { status: "saved" });
		assert.equal(store.all()[0].note, "Added");
		assert.deepEqual(store.setNote({ id: "local-1", note: "   " }), { status: "saved" });
		assert.equal("note" in store.all()[0], false);
	});

	it("refuses a note for a highlight that is not kept, or too long, or that cannot be written", () => {
		const storage = mapStorage();
		const store = storeOn(storage);
		store.add({ url: ARTICLE_URL, text: ARTICLE_TEXT, ...rangeOf("The first") });

		assert.deepEqual(store.setNote({ id: "local-9", note: "Added" }), { status: "missing" });
		assert.deepEqual(store.setNote({ id: "local-1", note: "n".repeat(1001) }), { status: "too-long" });
		storage.setItem = () => {
			throw new Error("QuotaExceededError");
		};
		assert.deepEqual(store.setNote({ id: "local-1", note: "Added" }), { status: "unavailable" });
	});
});
