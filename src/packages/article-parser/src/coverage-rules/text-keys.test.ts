import { candidateKeys, cellTriple, codeKey, countKey, indexOfKey, normalise, stream, tokenCount } from "./text-keys";

describe("normalise", () => {
	it("folds compatibility forms, case, punctuation and symbols, and collapses whitespace", () => {
		expect(normalise("  Ｆｕｌｌ-width,\n  “Quoted” $5 → done!  ")).toBe("full width quoted 5 done");
	});
});

describe("tokenCount", () => {
	it("counts words in a word-script run", () => {
		expect(tokenCount("npm install")).toBe(2);
	});

	it("counts one token per character in a run that is mostly CJK", () => {
		expect(tokenCount("設定を開く ok")).toBe(7);
	});

	it("counts nothing in a run without letters", () => {
		expect(tokenCount(" !! ")).toBe(0);
	});
});

describe("candidateKeys", () => {
	it("tries the middle window, then the last, then the first", () => {
		const run = "w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12";
		expect(candidateKeys(run)).toEqual({
			keys: ["w3 w4 w5 w6 w7 w8 w9 w10", "w5 w6 w7 w8 w9 w10 w11 w12", "w1 w2 w3 w4 w5 w6 w7 w8"],
			fullWindow: true,
		});
	});

	it("uses the whole run when it is shorter than the window", () => {
		expect(candidateKeys("Run npm install.")).toEqual({ keys: ["run npm install"], fullWindow: false });
	});

	it("windows a CJK run by characters and keeps the substring between them", () => {
		const run = "一二三四五六七八九十 一二三四五";
		expect(candidateKeys(run)).toEqual({
			keys: ["二三四五六七八九十 一二三", "四五六七八九十 一二三四五", "一二三四五六七八九十 一二"],
			fullWindow: true,
		});
	});

	it("refuses a run with no token", () => {
		expect(() => candidateKeys("...")).toThrow("a candidate key needs at least one token");
	});
});

describe("stream", () => {
	it("joins the normalised text runs and leaves out every other block and empty runs", () => {
		expect(
			stream([
				{ kind: "text", text: "First, run." },
				{ kind: "heading", text: "Title" },
				{ kind: "text", text: "—" },
				{ kind: "code", text: "x = 1" },
				{ kind: "text", text: "Second run" },
			]),
		).toBe("first run second run");
	});
});

describe("indexOfKey", () => {
	it("matches a word-script key only on word boundaries", () => {
		expect(indexOfKey({ stream: "install npm installer npm install", key: "npm install", from: 0 })).toBe(22);
	});

	it("starts searching at the given position", () => {
		expect(indexOfKey({ stream: "a b a b", key: "a b", from: 1 })).toBe(4);
	});

	it("matches a CJK key anywhere", () => {
		expect(indexOfKey({ stream: "前置き設定を開く", key: "設定を開く", from: 0 })).toBe(3);
	});

	it("answers -1 when the key is absent", () => {
		expect(indexOfKey({ stream: "a b", key: "c", from: 0 })).toBe(-1);
	});
});

describe("countKey", () => {
	it("counts every occurrence, overlapping ones included", () => {
		expect(countKey({ stream: "a a a", key: "a a" })).toBe(2);
		expect(countKey({ stream: "b", key: "a" })).toBe(0);
	});
});

describe("codeKey", () => {
	it("keeps a short code block whole", () => {
		expect(codeKey("git rebase -i HEAD~3")).toBe("git rebase -i HEAD~3");
	});

	it("keys a long code block by its first 200 characters and its length", () => {
		const text = "x".repeat(250);
		expect(codeKey(text)).toBe(`${"x".repeat(200)}|250`);
	});
});

describe("cellTriple", () => {
	it("joins the normalised row key, header and value", () => {
		expect(cellTriple({ rowKey: "Trophy:", header: "Rarity", value: "Gold!" })).toBe("trophy\u0000rarity\u0000gold");
	});
});
