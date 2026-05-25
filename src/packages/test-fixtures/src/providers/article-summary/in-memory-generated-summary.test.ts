import { initInMemoryGeneratedSummary } from "./in-memory-generated-summary";

const URL = "https://example.com/article";

describe("initInMemoryGeneratedSummary", () => {
	describe("findGeneratedSummary", () => {
		it("returns undefined when no row exists", async () => {
			const store = initInMemoryGeneratedSummary();
			expect(await store.findGeneratedSummary(URL)).toBeUndefined();
		});
	});

	describe("markSummaryPending", () => {
		it("creates a pending row when none existed", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryPending({ url: URL });

			expect(await store.findGeneratedSummary(URL)).toEqual({ status: "pending" });
		});

		it("does not regress a row that has already gone ready", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryReady({ url: URL, summary: "S" });
			await store.markSummaryPending({ url: URL });

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "S",
			});
		});

		it("does not regress a row that has already been skipped", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummarySkipped({ url: URL, reason: "too-short" });
			await store.markSummaryPending({ url: URL });

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "skipped",
				reason: "too-short",
			});
		});
	});

	describe("forceMarkSummaryPending", () => {
		it("overrides a ready row so an operator recrawl re-runs the worker", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryReady({ url: URL, summary: "S" });
			await store.forceMarkSummaryPending({ url: URL });

			expect(await store.findGeneratedSummary(URL)).toEqual({ status: "pending" });
		});
	});

	describe("markSummaryReady", () => {
		it("writes the summary and excerpt", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryReady({
				url: URL,
				summary: "Long summary text",
				excerpt: "Lead.",
			});

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "Long summary text",
				excerpt: "Lead.",
			});
		});

		it("omits excerpt when not supplied", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryReady({ url: URL, summary: "Only summary" });

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "Only summary",
			});
		});
	});

	describe("markSummarySkipped", () => {
		it("writes the skip reason", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummarySkipped({ url: URL, reason: "too-short" });

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "skipped",
				reason: "too-short",
			});
		});

		it("omits reason when not supplied", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummarySkipped({ url: URL });

			expect(await store.findGeneratedSummary(URL)).toEqual({ status: "skipped" });
		});
	});
});
