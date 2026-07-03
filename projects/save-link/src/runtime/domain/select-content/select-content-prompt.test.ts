import { MAX_CANDIDATE_HTML_CHARS, buildSelectContentUserMessage } from "./select-content-prompt";

describe("buildSelectContentUserMessage", () => {
	it("passes candidate html through untouched when it fits the per-candidate budget", () => {
		const message = buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [{ tier: "tier-0", title: "T", wordCount: 3, html: "<p>small</p>" }],
		});

		expect(message).toContain("<p>small</p>");
		expect(message).not.toContain("[truncated:");
	});

	it("caps oversized candidate html so the prompt always fits the model's context window", () => {
		const oversized = "x".repeat(MAX_CANDIDATE_HTML_CHARS + 10);
		const message = buildSelectContentUserMessage({
			url: "https://example.com/a",
			candidates: [
				{ tier: "tier-0", title: "T", wordCount: 100, html: oversized },
				{ tier: "tier-1", title: "T", wordCount: 100, html: "<p>small</p>" },
			],
		});

		expect(message).not.toContain(oversized);
		expect(message).toContain(
			`[truncated: showing the first ${MAX_CANDIDATE_HTML_CHARS} of ${MAX_CANDIDATE_HTML_CHARS + 10} characters]`,
		);
		expect(message).toContain("<p>small</p>");
		expect(message.length).toBeLessThan(MAX_CANDIDATE_HTML_CHARS + 1_000);
	});
});
