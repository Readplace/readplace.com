import { initArchiveHealth } from "./archive-health";
import type { ArchiveHealthReport } from "./archive-health-evidence";
import type { SaveHealthSource } from "./health-sources";

const originalUrl = "https://example.com/article";
const captureUrl = `https://web.archive.org/web/2008/${originalUrl}`;
const source: SaveHealthSource = { label: "Wayback", url: captureUrl, expectedDestinationUrl: originalUrl, expectedContent: "article", expectsThumbnail: false, save: { kind: "archive", captureUrl, requireFreshArchive: true } };
const result: ArchiveHealthReport = { label: source.label, saveAttemptId: "attempt", originalUrl, captureUrl, captureHttpStatus: 200, captureContentHash: "hash", comparisonPromptHash: "prompt-hash", freshArchive: "article-confirmed", outcome: "selected", selected: { id: "candidate", kind: "wrapper", fresh: true, contentHash: "hash" } };

it("saves sequentially, waits for its own completed comparison and checks direct-save deduplication", async () => {
	let time = 0;
	let polls = 0;
	const operations: string[] = [];
	const reports: unknown[] = [];
	const check = initArchiveHealth({
		client: {
			login: async () => { operations.push("login"); },
			save: async (url) => { operations.push(url); return "attempt"; },
			findOnlyCard: async () => "same-card",
		},
		evidence: { verify: async () => ++polls === 1 ? undefined : result },
		readCompletionMessages: async (input) => { operations.push(input.saveAttemptId); return []; },
		now: () => time, wait: async () => { time += 3; }, timeoutMs: 30,
		report: async (report) => { reports.push(report); },
	});
	await check(source);
	await check({ ...source, url: originalUrl, save: { kind: "direct" } });
	expect(operations).toEqual(["login", captureUrl, "attempt", "attempt", originalUrl]);
	expect(reports).toEqual([result, { label: source.label, saveAttemptId: "attempt", originalUrl, cardId: "same-card", outcome: "deduplicated" }]);
});

it("times out without fresh correlated evidence even when the original card is already ready", async () => {
	let time = 0;
	const check = initArchiveHealth({
		client: { login: async () => {}, save: async () => "missing-attempt", findOnlyCard: async () => "existing-card" },
		evidence: { verify: async () => undefined }, readCompletionMessages: async () => [],
		now: () => time, wait: async () => { time += 3; }, timeoutMs: 6, report: async () => {},
	});
	await expect(check(source)).rejects.toThrow("no completed comparison for accepted save attempt missing-attempt");
});

it("rejects a calendar save that produces another card for the same original", async () => {
	let saves = 0;
	const check = initArchiveHealth({
		client: { login: async () => {}, save: async () => `attempt-${++saves}`, findOnlyCard: async () => `card-${saves}` },
		evidence: { verify: async () => result }, readCompletionMessages: async () => [],
		now: () => 0, wait: async () => {}, timeoutMs: 30, report: async () => {},
	});
	await check(source);
	await expect(check({ ...source, url: `https://web.archive.org/web/*/${originalUrl}` })).rejects.toThrow("same card");
});

it("waits for an eventually visible original card after comparison has completed", async () => {
	let time = 0;
	let reads = 0;
	const check = initArchiveHealth({
		client: { login: async () => {}, save: async () => "attempt", findOnlyCard: async () => ++reads === 1 ? undefined : "card" },
		evidence: { verify: async () => result }, readCompletionMessages: async () => [],
		now: () => time, wait: async () => { time += 3; }, timeoutMs: 30, report: async () => {},
	});
	await check(source);
	expect(reads).toBe(2);
});
