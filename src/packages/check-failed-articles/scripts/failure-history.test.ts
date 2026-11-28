import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CollectedFailedRow } from "./collect-failed-rows";
import { classifyFailureHistory } from "./failure-history";
import type { FailureHistoryLogMatch } from "./failure-history-logs";
import { initLoadPublicViewEvidence } from "./failure-history-public";
import { toCanaryReportRow } from "./failed-articles-issue";
import { parseReviewedAccess } from "./reviewed-access";

const SAVED = "2026-05-10T00:00:00.000Z";
const ADMITTED = "2026-05-11T00:00:00.000Z";
const opened = Date.parse("2026-05-10T06:00:00.000Z");
const terminalFailure = Date.parse("2026-05-11T04:00:00.000Z");
const laterOpen = terminalFailure + 60_000;
const cutoff = new Date("2026-05-12T00:00:00.000Z");

const row: CollectedFailedRow = {
	articleKey: "site.test/post",
	originalUrl: "https://site.test/post?source=private",
	axes: ["crawl-failed"],
	reasons: { "crawl-failed": '{"kind":"parse-error"}' },
	savedAt: SAVED,
	contentFetchedAt: undefined,
	fullCrawlRequestedAt: ADMITTED,
	resolutionOnViewClaimedAt: ADMITTED,
};
const listLogs: FailureHistoryLogMatch = {
	admissionSurface: "readlist-siren",
	admissionCovered: true,
	ownerOpenTimes: [],
	ownerOpensCovered: true,
};
const defaults = {
	row, cutoff, logs: listLogs, publicOpenRecorded: false, reviewedAccess: new Map(),
};

const reviewedRow = { ...row, articleKey: 'site.test/雪?q=%2F&quote="' };
const reviewedRowDigest = "19aaefe405503c79762f77c986c3e659e41d64bdbdb2438ee27a084c4c3e9f52";

type HistoryInput = Parameters<typeof classifyFailureHistory>[0];
const classify = (input: Partial<HistoryInput> = {}) => classifyFailureHistory({ ...defaults, ...input });

describe("failed article history groups", () => {
	it("counts a same-lifetime owner event before admission instead of the competing list trigger", () => {
		const classified = classify({ logs: { ...listLogs, ownerOpenTimes: [opened] } });
		assert.equal(classified.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(toCanaryReportRow(classified).labels, ["crawl-failed", "Reader opened before failure", "Signed-in reader opened before failure"]);
	});

	it("keeps a proven owner open when a different analytics partition was unavailable", () => {
		const classified = classify({
			logs: { ...listLogs, ownerOpenTimes: [opened], ownerOpensCovered: false },
		});
		assert.equal(classified.historyGroup, "reader-opened-before-failure");
	});

	it("accepts a winning owner reader admission as positive evidence", () => {
		for (const surface of ["reader", "reader-capture-gave-up"] as const) {
			assert.equal(
				classify({ logs: { ...listLogs, admissionSurface: surface, ownerOpensCovered: false } }).historyGroup,
				"reader-opened-before-failure",
			);
		}
	});

	it("groups a matched list admission with no confirmed reader open under the readlist trigger", () => {
		for (const surface of ["readlist-html", "readlist-siren"] as const) {
			const classified = classify({ logs: { ...listLogs, admissionSurface: surface } });
			assert.equal(classified.historyGroup, "readlist-admission-no-reader-open");
			assert.deepEqual(toCanaryReportRow(classified).labels, [
				"crawl-failed", "Readlist started the crawl, no reader open confirmed",
			]);
		}
	});

	it("counts a proven public open even when the underlying admission was a readlist", () => {
		const publicOnly = classify({ publicOpenRecorded: true });
		assert.equal(publicOnly.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(publicOnly.readerRoutes, ["public"]);
		assert.deepEqual(toCanaryReportRow(publicOnly).labels, [
			"crawl-failed", "Reader opened before failure", "Public reader open recorded before failure",
		]);
	});

	it("retains both routes when both have confirmed opens", () => {
		const alsoOwner = classify({ publicOpenRecorded: true, logs: { ...listLogs, ownerOpenTimes: [opened] } });
		assert.equal(alsoOwner.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(alsoOwner.readerRoutes, ["signed-in", "public"]);
	});

	it("keeps a proven public open even when signed-in evidence is unavailable or came later", () => {
		const unknownOwner = classify({ publicOpenRecorded: true, logs: undefined });
		assert.equal(unknownOwner.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(unknownOwner.readerRoutes, ["public"]);
		const unboundedLaterOwner = classify({ publicOpenRecorded: true, logs: { ...listLogs, ownerOpenTimes: [laterOpen] } });
		assert.equal(unboundedLaterOwner.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(unboundedLaterOwner.readerRoutes, ["public"]);
	});

	it("leaves opens after terminal failure outside the reader-open group", async () => {
		const loadPublicViews = initLoadPublicViewEvidence({ query: async () => [new Map([
			["timestamp", new Date(laterOpen).toISOString()],
			["path", "/view/site.test/post"],
			["article_host", "site.test"],
		])] });
		const publicViews = await loadPublicViews({ rows: [{
			key: row.articleKey, savedAt: SAVED, fullCrawlRequestedAt: ADMITTED,
		}], now: cutoff });
		const classified = classify({
			logs: { ...listLogs, ownerOpenTimes: [laterOpen] },
			publicOpenRecorded: publicViews.opened.has(row.articleKey),
		});
		assert.equal(classified.historyGroup, "readlist-admission-no-reader-open");
		assert.equal(classified.readerRoutes, undefined);
	});

	it("keeps the readlist trigger when the owner history is incomplete or shows no open before admission", () => {
		const noConfirmedOpen: readonly Partial<HistoryInput>[] = [
			{ logs: { ...listLogs, ownerOpensCovered: false } },
			{ logs: { ...listLogs, ownerOpenTimes: [laterOpen] } },
			{ logs: { ...listLogs, ownerOpenTimes: [Date.parse(ADMITTED)] } },
		];
		for (const evidence of noConfirmedOpen) {
			assert.equal(classify(evidence).historyGroup, "readlist-admission-no-reader-open");
		}
	});

	it("keeps an unverified or mismatched admission unknown", () => {
		const ambiguous: readonly Partial<HistoryInput>[] = [
			{ logs: undefined },
			{ logs: { ...listLogs, admissionCovered: false } },
			{ logs: { ...listLogs, admissionSurface: "queue-digest" } },
			{ row: { ...row, resolutionOnViewClaimedAt: SAVED } },
			{ row: { ...row, savedAt: ADMITTED, fullCrawlRequestedAt: SAVED } },
			{ row: { ...row, fullCrawlRequestedAt: undefined } },
		];
		for (const evidence of ambiguous) assert.equal(classify(evidence).historyGroup, "other-unknown");
	});
});

describe("reviewed access history", () => {
	it("uses the exact saved identity and admission strings to recover a reviewed open after logs expire", () => {
		const reviewedAccess = parseReviewedAccess(JSON.stringify([[reviewedRowDigest, "public-reader-opened-before-failure"]]));
		const input = {
			row: reviewedRow, logs: undefined, reviewedAccess,
		};
		const matched = classify(input);
		assert.equal(matched.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(matched.readerRoutes, ["public"]);
		for (const changed of [
			{ articleKey: reviewedRow.articleKey.toUpperCase() },
			{ savedAt: "2026-05-10T00:00:01.000Z" },
			{ fullCrawlRequestedAt: "2026-05-11T00:00:01.000Z" },
			{ fullCrawlRequestedAt: "2026-05-11T00:00:00.000+00:00" },
		]) {
			assert.equal(classify({ ...input, row: { ...reviewedRow, ...changed } }).historyGroup, "other-unknown");
		}
	});

	it("unions reviewed and live reader routes and counts a repeated public route once", () => {
		const input = {
			row: reviewedRow,
			reviewedAccess: parseReviewedAccess(JSON.stringify([[reviewedRowDigest, "public-reader-opened-before-failure"]])),
			logs: { ...listLogs, ownerOpenTimes: [opened] },
		};
		for (const publicOpenRecorded of [false, true]) {
			const classified = classify({ ...input, publicOpenRecorded });
			assert.equal(classified.historyGroup, "reader-opened-before-failure");
			assert.deepEqual(classified.readerRoutes, ["signed-in", "public"]);
		}
	});

	it("retains a reviewed signed-in open with any live public evidence", () => {
		const reviewedAccess = parseReviewedAccess(JSON.stringify([[reviewedRowDigest, "signed-in-reader-opened-before-failure"]]));
		const input = { row: reviewedRow, logs: undefined, reviewedAccess };
		assert.deepEqual(classify(input).readerRoutes, ["signed-in"]);
		assert.deepEqual(classify({ ...input, publicOpenRecorded: true }).readerRoutes, ["signed-in", "public"]);
	});

	it("retains the reviewed readlist trigger and lets stronger live evidence take priority", () => {
		const reviewedAccess = parseReviewedAccess(JSON.stringify([[reviewedRowDigest, "readlist-admission-reader-history-incomplete"]]));
		const input = { row: reviewedRow, reviewedAccess };
		assert.equal(classify({ ...input, logs: undefined }).historyGroup, "readlist-admission-no-reader-open");
		assert.equal(classify(input).historyGroup, "readlist-admission-no-reader-open");
		const reader = classify({ ...input, logs: { ...listLogs, ownerOpenTimes: [opened] } });
		assert.equal(reader.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(reader.readerRoutes, ["signed-in"]);
	});

	it("retains reviewed triggers without inferring a reader open", () => {
		for (const category of ["authenticated-submission", "scheduled-digest-preparation", "operator-recrawl"] as const) {
			const classified = classify({
				row: reviewedRow,
				logs: undefined,
				reviewedAccess: parseReviewedAccess(JSON.stringify([[reviewedRowDigest, category]])),
			});
			assert.equal(classified.historyGroup, category);
			assert.equal(classified.readerRoutes, undefined);
		}
	});

	it("uses live evidence when no reviewed access history is configured", () => {
		for (const configuration of [undefined, "", "[]"]) {
			assert.equal(classify({ reviewedAccess: parseReviewedAccess(configuration) }).historyGroup, "readlist-admission-no-reader-open");
		}
	});

	it("rejects malformed or ambiguous configuration without echoing input", () => {
		for (const configuration of [
			'https://site.test/private-url?token=private',
			JSON.stringify({ [reviewedRowDigest]: "operator-recrawl" }),
			JSON.stringify([["https://site.test/private-url?token=private", "operator-recrawl"]]),
			JSON.stringify([[reviewedRowDigest.toUpperCase(), "operator-recrawl"]]),
			JSON.stringify([[`${reviewedRowDigest.slice(1)}\n`, "operator-recrawl"]]),
			JSON.stringify([[reviewedRowDigest, "public-reader-opened-after-failure"]]),
			JSON.stringify([[reviewedRowDigest, "operator-recrawl"], [reviewedRowDigest, "authenticated-submission"]]),
		]) {
			assert.throws(() => parseReviewedAccess(configuration), {
				message: "FAILED_ARTICLES_REVIEWED_ACCESS must be a JSON array of [unique lowercase SHA-256 hex digest, known access category] pairs",
			});
		}
	});
});
