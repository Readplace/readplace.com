import { pickExcerpt, truncateForSeo } from "./article-summary.helpers";

describe("pickExcerpt", () => {
	it("returns the AI excerpt when status is ready and excerpt is present", () => {
		expect(
			pickExcerpt(
				{
					status: "ready",
					summary: "Long AI summary covering many points.",
					excerpt: "Short decision-helper blurb.",
				},
				"Parsed excerpt.",
			),
		).toBe("Short decision-helper blurb.");
	});

	it("returns the fallback when status is ready but excerpt is absent (does not use summary text)", () => {
		expect(
			pickExcerpt(
				{ status: "ready", summary: "Long AI summary covering many points." },
				"Parsed excerpt.",
			),
		).toBe("Parsed excerpt.");
	});

	it("returns the fallback when status is ready but excerpt is the empty string", () => {
		expect(
			pickExcerpt(
				{ status: "ready", summary: "AI summary.", excerpt: "" },
				"Parsed excerpt.",
			),
		).toBe("Parsed excerpt.");
	});

	it("returns the fallback when summary is undefined", () => {
		expect(pickExcerpt(undefined, "Parsed excerpt.")).toBe("Parsed excerpt.");
	});

	it("returns the fallback when status is pending", () => {
		expect(pickExcerpt({ status: "pending" }, "Parsed excerpt.")).toBe(
			"Parsed excerpt.",
		);
	});

	it("returns the fallback when status is failed", () => {
		expect(
			pickExcerpt({ status: "failed", reason: "boom" }, "Parsed excerpt."),
		).toBe("Parsed excerpt.");
	});

	it("returns the fallback when status is skipped", () => {
		expect(pickExcerpt({ status: "skipped" }, "Parsed excerpt.")).toBe(
			"Parsed excerpt.",
		);
	});
});

describe("truncateForSeo", () => {
	it("returns the text unchanged when within the limit", () => {
		expect(truncateForSeo("Short and sweet.")).toBe("Short and sweet.");
	});

	it("returns the text unchanged when exactly at the limit", () => {
		const text = "a".repeat(160);
		expect(truncateForSeo(text)).toBe(text);
	});

	it("truncates at the last word boundary and appends an ellipsis", () => {
		const long = `${"word ".repeat(40)}tail`;
		const result = truncateForSeo(long);

		expect(result.length).toBeLessThanOrEqual(160);
		expect(result.endsWith("…")).toBe(true);
		expect(result).toMatch(/\S…$/);
	});

	it("hard-cuts when the slice has no whitespace", () => {
		const noSpaces = "x".repeat(200);
		const result = truncateForSeo(noSpaces);

		expect(result).toBe(`${"x".repeat(159)}…`);
	});

	it("respects a custom maxChars argument", () => {
		expect(truncateForSeo("hello world there", 11)).toBe("hello…");
	});
});
