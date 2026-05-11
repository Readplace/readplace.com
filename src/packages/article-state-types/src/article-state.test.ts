import { CrawlStatusSchema, ReaderStatusSchema, SummaryStatusSchema } from "./article-state";

describe("SummaryStatusSchema", () => {
	it.each(["pending", "ready", "failed", "skipped"])("accepts %s", (value) => {
		expect(SummaryStatusSchema.parse(value)).toBe(value);
	});

	it("rejects unknown values", () => {
		expect(SummaryStatusSchema.safeParse("unknown").success).toBe(false);
	});
});

describe("CrawlStatusSchema", () => {
	it.each(["pending", "ready", "failed", "unsupported"])("accepts %s", (value) => {
		expect(CrawlStatusSchema.parse(value)).toBe(value);
	});

	it("rejects unknown values, including summary-only states", () => {
		expect(CrawlStatusSchema.safeParse("skipped").success).toBe(false);
		expect(CrawlStatusSchema.safeParse("absent").success).toBe(false);
	});
});

describe("ReaderStatusSchema", () => {
	it.each(["pending", "ready", "failed", "unsupported", "unavailable"])("accepts %s", (value) => {
		expect(ReaderStatusSchema.parse(value)).toBe(value);
	});

	it("rejects unknown values, including summary-only states", () => {
		expect(ReaderStatusSchema.safeParse("skipped").success).toBe(false);
		expect(ReaderStatusSchema.safeParse("absent").success).toBe(false);
	});
});
