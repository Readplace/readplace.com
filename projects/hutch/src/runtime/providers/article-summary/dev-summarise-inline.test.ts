import { devSummariseInline } from "./dev-summarise-inline";

describe("devSummariseInline", () => {
	it("returns skipped with reason 'too-short' for content under 200 characters", () => {
		const result = devSummariseInline({ html: "<p>Short article body.</p>" });

		expect(result).toEqual({ kind: "skipped", reason: "too-short" });
	});

	it("returns a ready summary with prefixed text and excerpt for longer content", () => {
		const html = `<p>${"A".repeat(500)}</p>`;

		const result = devSummariseInline({ html });

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.summary.startsWith("[dev summary] ")).toBe(true);
		expect(result.summary.endsWith("…")).toBe(true);
		expect(result.excerpt.length).toBe(160);
	});

	it("strips HTML tags so the summary is plain text, not markup", () => {
		const html = `<div class="page" id="readability-page-1"><h2>A computer the size of a card</h2><p>${"word ".repeat(60)}</p></div>`;

		const result = devSummariseInline({ html });

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.summary).not.toContain("<");
		expect(result.summary).toContain("A computer the size of a card");
		expect(result.excerpt).not.toContain("<");
	});
});
