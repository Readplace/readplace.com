import { buildDiffEntries } from "./build-diff-entries";

describe("buildDiffEntries", () => {
	it("returns an empty array when both texts are identical", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "no changes here", cleanedText: "no changes here" },
		]);
		expect(entries).toEqual([]);
	});

	it("captures a single-word replacement with the right offset", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "the Vepository in question", cleanedText: "the Repository in question" },
		]);
		expect(entries).toHaveLength(1);
		expect(entries[0].diff_id).toBe(1);
		expect(entries[0].pageIndex).toBe(0);
		expect(entries[0].original).toBe("Vepository");
		expect(entries[0].replacement).toBe("Repository");
		expect(entries[0].charOffset).toBe("the ".length);
	});

	it("includes ~30 words of context before and after the change", () => {
		const before = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
		const after = Array.from({ length: 50 }, (_, i) => `nextword${i}`).join(" ");
		const original = `${before} BAD ${after}`;
		const cleaned = `${before} GOOD ${after}`;

		const entries = buildDiffEntries([{ pageIndex: 0, originalText: original, cleanedText: cleaned }]);

		expect(entries).toHaveLength(1);
		expect(entries[0].contextBefore.split(" ")).toHaveLength(30);
		expect(entries[0].contextAfter.split(" ")).toHaveLength(30);
		expect(entries[0].contextBefore).toContain("word49");
		expect(entries[0].contextAfter).toContain("nextword0");
	});

	it("uses fewer context words when the change is near the start or end", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "BAD trailing words here", cleanedText: "GOOD trailing words here" },
		]);
		expect(entries[0].contextBefore).toBe("");
		expect(entries[0].contextAfter).toBe("trailing words here");
	});

	it("captures an isolated insertion (original is empty)", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "alpha gamma", cleanedText: "alpha beta gamma" },
		]);
		expect(entries).toHaveLength(1);
		expect(entries[0].original).toBe("");
		expect(entries[0].replacement.trim()).toBe("beta");
	});

	it("captures an isolated removal (replacement is empty)", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "alpha beta gamma", cleanedText: "alpha gamma" },
		]);
		expect(entries).toHaveLength(1);
		expect(entries[0].original.trim()).toBe("beta");
		expect(entries[0].replacement).toBe("");
	});

	it("assigns monotonically increasing, unique diff_ids across multiple pages (each page's entries strictly precede the next page's)", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "Vepository one", cleanedText: "Repository one" },
			{ pageIndex: 1, originalText: "Wonkey two", cleanedText: "Donkey two" },
			{ pageIndex: 2, originalText: "JxagaR three", cleanedText: "Apparatus three" },
		]);
		// At least one entry per page; ids strictly increasing; never repeated.
		expect(entries.length).toBeGreaterThanOrEqual(3);
		const ids = entries.map((e) => e.diff_id);
		const sorted = [...ids].sort((a, b) => a - b);
		expect(ids).toEqual(sorted);
		expect(new Set(ids).size).toBe(ids.length);
		// And page-index order is preserved as ids increase.
		const pages = entries.map((e) => e.pageIndex);
		const sortedPages = [...pages].sort((a, b) => a - b);
		expect(pages).toEqual(sortedPages);
	});

	it("attaches each entry to the page that produced it", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 5, originalText: "Vepository", cleanedText: "Repository" },
			{ pageIndex: 9, originalText: "antenna", cleanedText: "antenna" },
			{ pageIndex: 11, originalText: "Wonkey", cleanedText: "Donkey" },
		]);
		expect(entries).toHaveLength(2);
		expect(entries[0].pageIndex).toBe(5);
		expect(entries[1].pageIndex).toBe(11);
	});

	it("collapses an immediately consecutive removed+added pair into a single entry (no intervening unchanged tokens)", () => {
		// Single-word substitution with no whitespace splitting: diffWords sees
		// one removed + one added in a row, so the collapse loop produces one
		// entry. When the diff library inserts unchanged whitespace between
		// halves of a hyphenated word — e.g. "Veposi- tory" → "Repository" —
		// the collapse cannot merge across that unchanged token; the downstream
		// applyDecisions handles the multi-entry case fine.
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "the Vepository here", cleanedText: "the Repository here" },
		]);
		expect(entries).toHaveLength(1);
		expect(entries[0].original).toBe("Vepository");
		expect(entries[0].replacement).toBe("Repository");
	});

	it("computes charOffset relative to the page's originalText (not the document)", () => {
		const entries = buildDiffEntries([
			{ pageIndex: 0, originalText: "ABC DEFG", cleanedText: "ABC ZZZZ" },
			{ pageIndex: 1, originalText: "QQQQ", cleanedText: "ZZZZ" },
		]);
		expect(entries).toHaveLength(2);
		expect(entries[0].charOffset).toBe("ABC ".length);
		// Page 1's entry must use offset 0 (its own page), not 8 (document-relative).
		expect(entries[1].charOffset).toBe(0);
	});
});
