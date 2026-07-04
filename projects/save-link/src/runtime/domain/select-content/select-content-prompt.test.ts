import { noopLogger, type HutchLogger } from "@packages/hutch-logger";
import {
	CHARS_PER_INPUT_TOKEN,
	INPUT_TOKEN_BUDGET,
	TOTAL_HTML_CHAR_BUDGET,
	buildSelectContentUserMessage,
	perCandidateHtmlCap,
} from "./select-content-prompt";

describe("perCandidateHtmlCap", () => {
	it("gives a single candidate the whole html budget", () => {
		expect(perCandidateHtmlCap(1)).toBe(TOTAL_HTML_CHAR_BUDGET);
	});

	it("splits the budget evenly across candidates", () => {
		expect(perCandidateHtmlCap(2)).toBe(Math.floor(TOTAL_HTML_CHAR_BUDGET / 2));
		expect(perCandidateHtmlCap(3)).toBe(Math.floor(TOTAL_HTML_CHAR_BUDGET / 3));
	});
});

describe("buildSelectContentUserMessage", () => {
	it("passes condensed candidate html through untouched when it fits the per-candidate budget", () => {
		const message = buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [{ tier: "tier-0", title: "T", wordCount: 3, html: "<p>small</p>" }],
			logger: noopLogger,
		});

		expect(message).toContain("<p>small</p>");
		expect(message).not.toContain("[truncated:");
	});

	it("caps oversized candidate html to its per-candidate share so the prompt fits the context window", () => {
		const cap = perCandidateHtmlCap(2);
		const oversized = "x".repeat(cap + 10);
		const message = buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 100, html: oversized },
				{ tier: "tier-1", title: "T", wordCount: 100, html: "<p>small</p>" },
			],
			logger: noopLogger,
		});

		expect(message).not.toContain(oversized);
		expect(message).toContain(
			`[truncated: showing the first ${cap} of ${cap + 10} characters]`,
		);
		expect(message).toContain("<p>small</p>");
	});

	it("logs an ERROR naming the candidate whenever it has to truncate, so the dashboard widget surfaces lost signal", () => {
		const error = jest.fn();
		const logger: HutchLogger = { ...noopLogger, error };
		const cap = perCandidateHtmlCap(2);

		buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 100, html: "x".repeat(cap + 10) },
				{ tier: "tier-1", title: "T", wordCount: 100, html: "<p>small</p>" },
			],
			logger,
		});

		expect(error).toHaveBeenCalledTimes(1);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("truncating"),
			expect.objectContaining({ url: "https://example.com/a", tier: "tier-0", cleanedChars: cap + 10, cap }),
		);
	});

	it("does not log an ERROR when every candidate fits", () => {
		const error = jest.fn();
		const logger: HutchLogger = { ...noopLogger, error };

		buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [{ tier: "tier-0", title: "T", wordCount: 3, html: "<p>small</p>" }],
			logger,
		});

		expect(error).not.toHaveBeenCalled();
	});

	it("truncates every overflowing candidate to its share and keeps the whole message within budget", () => {
		const cap = perCandidateHtmlCap(2);
		const message = buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 100, html: "x".repeat(cap + 5_000) },
				{ tier: "tier-1", title: "T", wordCount: 100, html: "y".repeat(cap + 5_000) },
			],
			logger: noopLogger,
		});

		const marker = `[truncated: showing the first ${cap} of ${cap + 5_000} characters]`;
		expect(message.match(/\[truncated: showing the first \d+ of \d+ characters\]/g)).toEqual([
			marker,
			marker,
		]);

		const smallHeaderAllowance = 2_000;
		expect(message.length).toBeLessThanOrEqual(TOTAL_HTML_CHAR_BUDGET + smallHeaderAllowance);
	});

	it("keeps a Wikipedia-sized pair under DeepSeek's input token budget (the original 400 can no longer occur)", () => {
		const message = buildSelectContentUserMessage({
			url: "https://en.wikipedia.org/wiki/Reading",
			candidates: [
				{ tier: "tier-0", title: "Reading", wordCount: 200_000, html: "x".repeat(1_200_000) },
				{ tier: "tier-1", title: "Reading", wordCount: 200_000, html: "y".repeat(1_200_000) },
			],
			logger: noopLogger,
		});

		const estimatedInputTokens = message.length / CHARS_PER_INPUT_TOKEN;
		expect(estimatedInputTokens).toBeLessThan(INPUT_TOKEN_BUDGET);
	});
});
