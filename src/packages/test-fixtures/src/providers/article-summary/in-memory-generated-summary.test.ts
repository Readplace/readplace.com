import { toArticleTopics } from "@packages/domain/article";
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
			await store.markSummaryReady({ url: URL, summary: "S", topics: [] });
			await store.markSummaryPending({ url: URL });

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "S",
				topics: [],
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

	describe("markSummaryReady", () => {
		it("writes the summary, excerpt and topics", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryReady({
				url: URL,
				summary: "Long summary text",
				excerpt: "Lead.",
				topics: toArticleTopics(["Productivity", "Focus"]),
			});

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "Long summary text",
				excerpt: "Lead.",
				topics: ["Productivity", "Focus"],
			});
		});

		it("omits excerpt when not supplied", async () => {
			const store = initInMemoryGeneratedSummary();
			await store.markSummaryReady({ url: URL, summary: "Only summary", topics: [] });

			expect(await store.findGeneratedSummary(URL)).toEqual({
				status: "ready",
				summary: "Only summary",
				topics: [],
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
