import { estimateOutputTokens } from "./estimate-output-tokens";

describe("estimateOutputTokens", () => {
	it("sizes an ASCII page at DeepSeek's English rate times the headroom", () => {
		expect(estimateOutputTokens({ text: "a".repeat(1000), headroom: 2 })).toBe(600);
	});

	it("sizes a CJK page at twice the per-character rate, which the old flat estimate missed", () => {
		expect(estimateOutputTokens({ text: "计".repeat(1000), headroom: 2 })).toBe(1200);
	});

	it("gives CJK a bigger budget than ASCII for the same character count", () => {
		const ascii = estimateOutputTokens({ text: "a".repeat(2000), headroom: 2 });
		const cjk = estimateOutputTokens({ text: "计".repeat(2000), headroom: 2 });

		expect(cjk).toBeGreaterThan(ascii);
	});

	it("weights a mixed-script page between the two rates", () => {
		expect(estimateOutputTokens({ text: `${"a".repeat(500)}${"计".repeat(500)}`, headroom: 2 })).toBe(900);
	});

	it("scales with headroom so a markup-emitting stage can ask for more than a text-only one", () => {
		const text = "a".repeat(1000);

		expect(estimateOutputTokens({ text, headroom: 3 })).toBe(900);
		expect(estimateOutputTokens({ text, headroom: 2 })).toBe(600);
	});

	it("clears the cap that truncated a real page, where 1,034 ASCII characters overran 517 tokens", () => {
		expect(estimateOutputTokens({ text: "a".repeat(1034), headroom: 3 })).toBe(931);
	});

	it("floors very short pages so a one-line page still gets a usable budget", () => {
		expect(estimateOutputTokens({ text: "hi", headroom: 2 })).toBe(256);
	});

	it("floors empty text rather than requesting zero tokens", () => {
		expect(estimateOutputTokens({ text: "", headroom: 2 })).toBe(256);
	});

	it("counts astral characters once, not once per UTF-16 unit", () => {
		expect(estimateOutputTokens({ text: "😀".repeat(1000), headroom: 2 })).toBe(1200);
	});

	it("rounds up so a fractional estimate never under-provisions", () => {
		expect(estimateOutputTokens({ text: "a", headroom: 1 })).toBe(256);
	});
});
