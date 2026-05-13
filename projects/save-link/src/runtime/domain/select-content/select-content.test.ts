import { noopLogger } from "@packages/hutch-logger";
import { initSelectMostCompleteContent, type CreateSelectorChatCompletion } from "./select-content";

function fakeChat(content: string | null | undefined): CreateSelectorChatCompletion {
	return jest.fn().mockResolvedValue({ choices: [{ message: { content } }] });
}

describe("initSelectMostCompleteContent (variadic)", () => {
	it("maps a winner letter back to the candidate's tier", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat(JSON.stringify({ winner: "A", reason: "tier-0 is more complete" })),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 100, html: "<p>tier-0</p>" },
				{ tier: "tier-1", title: "T", wordCount: 50, html: "<p>tier-1</p>" },
			],
		});

		expect(result).toEqual({ winner: "tier-0", reason: "tier-0 is more complete" });
	});

	it("returns 'tie' when the model says 'tie'", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat(JSON.stringify({ winner: "tie", reason: "equally good" })),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 100, html: "<p>tier-0</p>" },
				{ tier: "tier-1", title: "T", wordCount: 100, html: "<p>tier-1</p>" },
			],
		});

		expect(result).toEqual({ winner: "tie", reason: "equally good" });
	});

	it("returns 'tie' on empty model response", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat(""),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 1, html: "" },
				{ tier: "tier-1", title: "T", wordCount: 1, html: "" },
			],
		});

		expect(result).toEqual({ winner: "tie", reason: "empty response" });
	});

	it("returns 'tie' on malformed JSON", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat("{not json"),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 1, html: "" },
				{ tier: "tier-1", title: "T", wordCount: 1, html: "" },
			],
		});

		expect(result).toEqual({ winner: "tie", reason: "malformed response" });
	});

	it("returns 'tie' when the model picks a label outside the candidate range", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat(JSON.stringify({ winner: "Z", reason: "out of range" })),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 1, html: "" },
				{ tier: "tier-1", title: "T", wordCount: 1, html: "" },
			],
		});

		expect(result).toEqual({ winner: "tie", reason: "unknown winner label" });
	});

	it("supports a single candidate (still maps via label A)", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat(JSON.stringify({ winner: "A", reason: "only candidate" })),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [{ tier: "tier-1", title: "T", wordCount: 1, html: "" }],
		});

		expect(result).toEqual({ winner: "tier-1", reason: "only candidate" });
	});

	it("returns 'tie' on schema mismatch (e.g. missing reason)", async () => {
		const { selectMostCompleteContent } = initSelectMostCompleteContent({
			createChatCompletion: fakeChat(JSON.stringify({ winner: "A" })),
			logger: noopLogger,
		});

		const result = await selectMostCompleteContent({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 1, html: "" },
				{ tier: "tier-1", title: "T", wordCount: 1, html: "" },
			],
		});

		expect(result).toEqual({ winner: "tie", reason: "schema mismatch" });
	});
});
