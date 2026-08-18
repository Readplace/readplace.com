import type { CrawlStatus, ReaderViewStatus, SummaryStatus } from "./article-state";
import {
	classifyCrawlOutcome,
	classifySummaryOutcome,
	CrawlStatusSchema,
	deriveReaderViewStatus,
	enteredReaderViewSucceeded,
	ReaderStatusSchema,
	SummaryStatusSchema,
} from "./article-state";

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
	it.each([
		"pending",
		"ready",
		"failed",
		"unsupported",
		"unavailable",
		"slow",
		"blocked",
		"not-found",
	])("accepts %s", (value) => {
		expect(ReaderStatusSchema.parse(value)).toBe(value);
	});

	it("rejects unknown values, including summary-only states", () => {
		expect(ReaderStatusSchema.safeParse("skipped").success).toBe(false);
		expect(ReaderStatusSchema.safeParse("absent").success).toBe(false);
	});
});

describe("deriveReaderViewStatus", () => {
	const cases: Array<{
		crawl: CrawlStatus;
		summary: SummaryStatus;
		expected: ReaderViewStatus;
	}> = [
		{ crawl: "pending", summary: "pending", expected: "loading" },
		{ crawl: "pending", summary: "ready", expected: "loading" },
		{ crawl: "pending", summary: "failed", expected: "failed" },
		{ crawl: "pending", summary: "skipped", expected: "loading" },
		{ crawl: "ready", summary: "pending", expected: "loading" },
		{ crawl: "ready", summary: "ready", expected: "succeeded" },
		{ crawl: "ready", summary: "failed", expected: "failed" },
		{ crawl: "ready", summary: "skipped", expected: "succeeded" },
		{ crawl: "failed", summary: "pending", expected: "failed" },
		{ crawl: "failed", summary: "ready", expected: "failed" },
		{ crawl: "failed", summary: "failed", expected: "failed" },
		{ crawl: "failed", summary: "skipped", expected: "failed" },
		{ crawl: "unsupported", summary: "pending", expected: "failed" },
		{ crawl: "unsupported", summary: "ready", expected: "failed" },
		{ crawl: "unsupported", summary: "failed", expected: "failed" },
		{ crawl: "unsupported", summary: "skipped", expected: "failed" },
	];

	it.each(cases)(
		"derives $expected from crawl=$crawl, summary=$summary",
		({ crawl, summary, expected }) => {
			expect(deriveReaderViewStatus({ crawl, summary })).toBe(expected);
		},
	);

	it("succeeds only when crawl is ready and summary is ready or skipped", () => {
		const succeeded = cases.filter((c) => c.expected === "succeeded");
		expect(succeeded).toEqual([
			{ crawl: "ready", summary: "ready", expected: "succeeded" },
			{ crawl: "ready", summary: "skipped", expected: "succeeded" },
		]);
	});
});

describe("classifyCrawlOutcome", () => {
	const cases: Array<{ status: CrawlStatus; expected: "pending" | "complete" | "error" }> = [
		{ status: "pending", expected: "pending" },
		{ status: "ready", expected: "complete" },
		{ status: "unsupported", expected: "complete" },
		{ status: "failed", expected: "error" },
	];

	it.each(cases)("classifies crawl=$status as $expected", ({ status, expected }) => {
		expect(classifyCrawlOutcome(status)).toBe(expected);
	});

	it("treats unsupported as complete (a supported determination), never error", () => {
		expect(classifyCrawlOutcome("unsupported")).toBe("complete");
	});
});

describe("classifySummaryOutcome", () => {
	const cases: Array<{ status: SummaryStatus; expected: "pending" | "complete" | "error" }> = [
		{ status: "pending", expected: "pending" },
		{ status: "ready", expected: "complete" },
		{ status: "skipped", expected: "complete" },
		{ status: "failed", expected: "error" },
	];

	it.each(cases)("classifies summary=$status as $expected", ({ status, expected }) => {
		expect(classifySummaryOutcome(status)).toBe(expected);
	});
});

describe("enteredReaderViewSucceeded", () => {
	const cases: Array<{ prior: ReaderViewStatus; next: ReaderViewStatus; expected: boolean }> = [
		{ prior: "loading", next: "succeeded", expected: true },
		{ prior: "failed", next: "succeeded", expected: true },
		{ prior: "succeeded", next: "succeeded", expected: false },
		{ prior: "loading", next: "loading", expected: false },
		{ prior: "succeeded", next: "failed", expected: false },
	];

	it.each(cases)("$prior -> $next is $expected", ({ prior, next, expected }) => {
		expect(enteredReaderViewSucceeded({ prior, next })).toBe(expected);
	});
});
