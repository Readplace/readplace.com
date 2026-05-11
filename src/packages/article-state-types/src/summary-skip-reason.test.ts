import { SummarySkipReasonSchema } from "./summary-skip-reason";

describe("SummarySkipReasonSchema", () => {
	it.each(["content-too-short", "ai-unavailable", "crawl-unsupported"])("accepts %s", (value) => {
		expect(SummarySkipReasonSchema.parse(value)).toBe(value);
	});

	it("rejects unknown values", () => {
		expect(SummarySkipReasonSchema.safeParse("future-reason").success).toBe(false);
	});
});
