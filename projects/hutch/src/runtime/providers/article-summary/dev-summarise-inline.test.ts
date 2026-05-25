import { devSummariseInline } from "./dev-summarise-inline";

describe("devSummariseInline", () => {
	it("returns skipped with reason 'too-short' for content under 200 characters", () => {
		const result = devSummariseInline({ textContent: "Short article body." });

		expect(result).toEqual({ kind: "skipped", reason: "too-short" });
	});

	it("returns a ready summary with prefixed text and excerpt for longer content", () => {
		const textContent = "A".repeat(500);

		const result = devSummariseInline({ textContent });

		expect(result.kind).toBe("ready");
		if (result.kind !== "ready") return;
		expect(result.summary.startsWith("[dev summary] ")).toBe(true);
		expect(result.summary.endsWith("…")).toBe(true);
		expect(result.excerpt.length).toBe(160);
	});
});
