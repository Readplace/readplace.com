import { sentenceBoundsAt } from "./sentence-bounds";

const text = "The fox jumps. The dog sleeps. The cat waits";

function sentenceAt(offset: number, source = text): string | undefined {
	const bounds = sentenceBoundsAt({ text: source, offset });
	return bounds === undefined ? undefined : source.slice(bounds.start, bounds.end);
}

describe("sentenceBoundsAt", () => {
	it("returns the sentence holding a caret in its middle", () => {
		expect(sentenceAt(text.indexOf("dog"))).toBe("The dog sleeps.");
	});

	it("returns the first sentence for a caret at the start of the text", () => {
		expect(sentenceAt(0)).toBe("The fox jumps.");
	});

	it("returns the last sentence for a caret at the end of the text", () => {
		expect(sentenceAt(text.length)).toBe("The cat waits");
	});

	it("returns a last sentence that has no terminal punctuation", () => {
		expect(sentenceAt(text.indexOf("cat"))).toBe("The cat waits");
	});

	it("returns the preceding sentence for a caret before the space between sentences", () => {
		expect(sentenceAt(text.indexOf(" The dog"))).toBe("The fox jumps.");
	});

	it("returns the following sentence for a caret after the space between sentences", () => {
		expect(sentenceAt(text.indexOf("The dog"))).toBe("The dog sleeps.");
	});

	it("leaves leading whitespace out of the sentence", () => {
		expect(sentenceAt(4, "  Indented line.")).toBe("Indented line.");
	});

	it("returns undefined for whitespace-only text", () => {
		expect(sentenceBoundsAt({ text: "   \n ", offset: 2 })).toBeUndefined();
	});

	it("returns undefined for empty text", () => {
		expect(sentenceBoundsAt({ text: "", offset: 0 })).toBeUndefined();
	});
});
