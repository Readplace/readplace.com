import assert from "node:assert/strict";
import { createKeywordMatchArticlesByInterest } from "./in-memory-match-articles-by-interest";
import type { ResurfaceCandidate } from "./resurface.types";

const candidates: ResurfaceCandidate[] = [
	{ id: "a", title: "A history of espresso", text: "How coffee spread across Europe." },
	{ id: "b", title: "Rust ownership", text: "Borrow checker fundamentals." },
	{ id: "c", title: "Latte art basics", text: "Pouring milk into coffee." },
];

describe("createKeywordMatchArticlesByInterest", () => {
	it("returns ids of candidates whose title or text contains a prompt word", async () => {
		const match = createKeywordMatchArticlesByInterest();

		const { matchedIds } = await match({ prompt: "coffee", candidates });

		assert.deepEqual(matchedIds, ["a", "c"]);
	});

	it("preserves candidate order across multiple matching terms", async () => {
		const match = createKeywordMatchArticlesByInterest();

		const { matchedIds } = await match({ prompt: "rust espresso", candidates });

		assert.deepEqual(matchedIds, ["a", "b"]);
	});

	it("returns an empty list when nothing matches", async () => {
		const match = createKeywordMatchArticlesByInterest();

		const { matchedIds } = await match({ prompt: "astrophysics", candidates });

		assert.deepEqual(matchedIds, []);
	});

	it("ignores empty tokens produced by surrounding whitespace", async () => {
		const match = createKeywordMatchArticlesByInterest();

		const { matchedIds } = await match({ prompt: "  rust  ", candidates });

		assert.deepEqual(matchedIds, ["b"]);
	});
});
