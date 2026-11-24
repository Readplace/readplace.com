import assert from "node:assert/strict";
import { test } from "node:test";
import { initLoadPublicViewEvidence } from "./failure-history-public";

function viewEvent(path: string, timestamp: string, host = "journal.example") {
	return new Map(Object.entries({ path, timestamp, article_host: host }));
}

test("counts each exact public reader path once, inside its save to admission interval", async () => {
	const savedAt = "2026-10-02T10:00:00.507Z";
	const fullCrawlRequestedAt = "2026-10-02T10:00:22.998Z";
	const read = initLoadPublicViewEvidence({
		query: async (query) => {
			assert.deepEqual(query.logGroupNames, ["/readplace/analytics"]);
			assert.match(query.queryString, /filter event = "view_opened" and article_host in \["journal\.example"\]/);
			assert.match(query.queryString, /display timestamp, path, article_host$/);
			assert.equal(query.startTime, Math.floor(Date.parse(savedAt) / 1_000));
			assert.equal(query.endTime, Math.ceil(Date.parse(fullCrawlRequestedAt) / 1_000));
			return [
				viewEvent("/view/journal.example/equal-to-save", savedAt),
				viewEvent("/view/journal.example/equal-to-save", "2026-10-02T10:00:15.000Z"),
				viewEvent("/view/http://journal.example/query%3Fsection=lead", "2026-10-02T10:00:15.000Z"),
				viewEvent("/view/journal.example/exact-admission", fullCrawlRequestedAt),
				viewEvent("/view/journal.example/before-save", "2026-10-02T10:00:00.506Z"),
				viewEvent("/view/journal.example/after-admission", "2026-10-02T10:00:23.001Z"),
				viewEvent("/view/journal.example/after-cutoff", "2026-10-03T10:00:23.001Z"),
				viewEvent("/view/journal.example/host-mismatch", "2026-10-02T10:00:15.000Z", "other.example"),
				viewEvent("/view/journal.example/alias", "2026-10-02T10:00:15.000Z"),
			];
		},
	});
	const keys = [
		"equal-to-save", "query?section=lead", "exact-admission", "before-save", "after-admission", "after-cutoff",
		"host-mismatch", "different-resource",
	];
	const result = await read({
		rows: keys.map((key) => ({ key: `journal.example/${key}`, savedAt, fullCrawlRequestedAt })),
		now: new Date("2026-10-02T12:00:00.000Z"),
	});
	assert.deepEqual([...result.opened], ["journal.example/equal-to-save", "journal.example/query?section=lead"]);
	assert.deepEqual([...result.covered], keys.map((key) => `journal.example/${key}`));
});

test("encoded path ambiguity leaves only affected hosts unknown and preserves definite opens", async () => {
	const savedAt = "2026-10-02T10:00:00.000Z";
	const fullCrawlRequestedAt = "2026-10-02T10:05:00.000Z";
	const timestamp = "2026-10-02T10:01:00.000Z";
	const read = initLoadPublicViewEvidence({
		query: async () => [
			viewEvent("/view/journal.example/ambiguous%2Fpath", timestamp),
			viewEvent("/view/journal.example/invalid%ZZ", timestamp),
			viewEvent("/view/journal.example/duplicated", timestamp),
			viewEvent("/view/journal.example/pending", timestamp),
			viewEvent("/view/journal.example/percent%2525", timestamp),
			viewEvent("/view/journal.example/chapter%23introduction", timestamp),
		],
	});
	const keys = [
		"ambiguous/path", "ambiguous%2Fpath", "invalid%ZZ", "duplicated", "duplicated", "percent%25", "chapter",
	];
	const result = await read({
		rows: [
			...keys.map((key) => ({ key: `journal.example/${key}`, savedAt, fullCrawlRequestedAt })),
			{ key: "journal.example/pending", savedAt },
			{ key: "other.example/untouched", savedAt, fullCrawlRequestedAt },
		],
		now: new Date("2026-10-02T12:00:00.000Z"),
	});
	assert.deepEqual([...result.opened], ["journal.example/percent%25", "journal.example/chapter"]);
	assert.deepEqual([...result.covered], ["other.example/untouched"]);
});

test("an unavailable window retains definite positives and gives coverage only for complete intervals", async () => {
	const cutoffs: number[] = [];
	const read = initLoadPublicViewEvidence({
		query: async ({ endTime }) => {
			cutoffs.push(endTime);
			return cutoffs.length === 1
				? undefined
				: [viewEvent("/view/journal.example/older", "2026-10-02T10:00:15.000Z")];
		},
	});
	const result = await read({
		rows: [
			{
				key: "journal.example/older",
				savedAt: "2026-10-02T10:00:00.000Z",
				fullCrawlRequestedAt: "2026-10-16T10:00:00.000Z",
			},
			{
				key: "journal.example/unknown",
				savedAt: "2026-10-02T10:00:00.000Z",
				fullCrawlRequestedAt: "2026-10-16T10:00:00.000Z",
			},
			{
				key: "journal.example/complete",
				savedAt: "2026-10-02T10:00:00.000Z",
				fullCrawlRequestedAt: "2026-10-04T10:00:00.000Z",
			},
		],
		now: new Date("2026-10-16T12:00:00.000Z"),
	});
	assert.deepEqual(cutoffs, [
		Date.parse("2026-10-16T10:00:00.000Z") / 1_000,
		Date.parse("2026-10-04T10:00:00.000Z") / 1_000,
	]);
	assert.deepEqual([...result.opened], ["journal.example/older"]);
	assert.deepEqual([...result.covered], ["journal.example/complete"]);
});

test("unsupported or ambiguous physical rows and an untimeable view do not grant coverage", async () => {
	const savedAt = "2026-10-02T10:00:00.000Z";
	const fullCrawlRequestedAt = "2026-10-02T10:05:00.000Z";
	const read = initLoadPublicViewEvidence({
		query: async () => [
			viewEvent("/view/journal.example/bad-time", "no event timestamp"),
			viewEvent("/view/journal.example/unrelated", "2026-10-02T10:02:00.000Z"),
		],
	});
	const result = await read({
		rows: [
			...["bad-time", "complete", "duplicate", "duplicate", "escaped%2Fpath", "escaped?query=ab%2Fcd"]
				.map((key) => ({ key: `journal.example/${key}`, savedAt, fullCrawlRequestedAt })),
			{ key: "invalid host/path", originalUrl: "https://journal.example/original", savedAt, fullCrawlRequestedAt },
			{ key: "other.example/escaped%2Fpath", savedAt, fullCrawlRequestedAt },
		],
		now: new Date("2026-10-02T12:00:00.000Z"),
	});
	assert.deepEqual([...result.opened], []);
	assert.deepEqual([...result.covered], [
		"journal.example/complete",
		"journal.example/escaped%2Fpath",
		"journal.example/escaped?query=ab%2Fcd",
		"other.example/escaped%2Fpath",
	]);
});
