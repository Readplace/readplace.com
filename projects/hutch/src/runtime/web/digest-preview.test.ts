import { buildDigestPreview } from "./digest-preview";

describe("buildDigestPreview", () => {
	it("prefers the excerpt, whitespace-collapsed, when the summary is ready with one", () => {
		const preview = buildDigestPreview({
			status: "ready",
			summary: "The full summary body.",
			excerpt: "A tidy   excerpt.",
		});

		expect(preview).toBe("A tidy excerpt.");
	});

	it("falls back to the summary, truncated to the excerpt-sized budget, when there is no excerpt", () => {
		const summary = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");

		const preview = buildDigestPreview({ status: "ready", summary });

		expect(preview.length).toBeLessThanOrEqual(200);
		expect(preview.endsWith("…")).toBe(true);
	});

	it("returns a short summary untruncated when it already fits the budget", () => {
		const preview = buildDigestPreview({ status: "ready", summary: "Short   summary   body." });

		expect(preview).toBe("Short summary body.");
	});

	it("returns an empty string when no summary is ready", () => {
		expect(buildDigestPreview(undefined)).toBe("");
		expect(buildDigestPreview({ status: "pending" })).toBe("");
	});
});
