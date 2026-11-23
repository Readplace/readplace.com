import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CollectedFailedRow } from "./collect-failed-rows";
import { classifyFailureHistory } from "./failure-history";
import type { FailureHistoryLogMatch } from "./failure-history-logs";
import { toCanaryReportRow } from "./failed-articles-issue";

const SAVED = "2026-05-10T00:00:00.000Z";
const ADMITTED = "2026-05-11T00:00:00.000Z";
const opened = Date.parse("2026-05-10T06:00:00.000Z");
const laterOpen = Date.parse("2026-05-11T06:00:00.000Z");
const cutoff = new Date("2026-05-12T00:00:00.000Z");

const row: CollectedFailedRow = {
	articleKey: "https://site.test/post",
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
const memberships = [{ savedAt: SAVED, viewedAt: undefined }];
const defaults = { row, cutoff, logs: listLogs, memberships, publicOpenRecorded: false, publicOpensCovered: true };

type HistoryInput = Parameters<typeof classifyFailureHistory>[0];
const classify = (input: Partial<HistoryInput> = {}) => classifyFailureHistory({ ...defaults, ...input });

describe("failed article history groups", () => {
	it("counts a same-lifetime owner event before admission instead of the competing list trigger", () => {
		const classified = classify({ logs: { ...listLogs, ownerOpenTimes: [opened] } });
		assert.equal(classified.historyGroup, "reader-opened-before-failure");
		assert.deepEqual(toCanaryReportRow(classified).labels, ["crawl-failed", "Signed-in reader opened before failure"]);
	});

	it("keeps a proven owner open when a different analytics partition was unavailable", () => {
		const classified = classify({
			logs: { ...listLogs, ownerOpenTimes: [opened], ownerOpensCovered: false },
			memberships: undefined,
			publicOpensCovered: false,
		});
		assert.equal(classified.historyGroup, "reader-opened-before-failure");
	});

	it("accepts a winning owner reader admission as positive evidence even with no surviving membership", () => {
		for (const surface of ["reader", "reader-capture-gave-up"] as const) {
			assert.equal(
				classify({ logs: { ...listLogs, admissionSurface: surface, ownerOpensCovered: false }, memberships: [] }).historyGroup,
				"reader-opened-before-failure",
			);
		}
	});

	it("requires a matched list admission and complete negative owner evidence across current memberships", () => {
		for (const surface of ["readlist-html", "readlist-siren"] as const) {
			const classified = classify({ logs: { ...listLogs, admissionSurface: surface } });
			assert.equal(classified.historyGroup, "readlist-loaded-no-reader-open");
		}
		const olderSaved = "2026-05-08T00:00:00.000Z";
		const olderViewed = "2026-05-09T00:00:00.000Z";
		assert.equal(classify({
			logs: { ...listLogs, ownerOpenTimes: [Date.parse(olderViewed)] },
			memberships: [{ savedAt: olderSaved, viewedAt: olderViewed }],
		}).historyGroup, "readlist-loaded-no-reader-open");
	});

	it("keeps a proven public open in Other even when the underlying admission was a readlist", () => {
		const publicOnly = classify({ publicOpenRecorded: true, publicOpensCovered: false });
		assert.equal(publicOnly.historyGroup, "other-unknown");
		assert.equal(publicOnly.publicReaderOnlyBeforeFailure, true);
		assert.deepEqual(toCanaryReportRow(publicOnly).labels, [
			"crawl-failed", "Other or unknown history", "Public reader open recorded before failure",
		]);
		const alsoOwner = classify({ publicOpenRecorded: true, logs: { ...listLogs, ownerOpenTimes: [opened] } });
		assert.equal(alsoOwner.historyGroup, "reader-opened-before-failure");
		assert.equal(alsoOwner.publicReaderOnlyBeforeFailure, undefined);
		const unknownOwner = classify({ publicOpenRecorded: true, logs: { ...listLogs, ownerOpensCovered: false } });
		assert.equal(unknownOwner.historyGroup, "other-unknown");
		assert.equal(unknownOwner.publicReaderOnlyBeforeFailure, undefined);
		const unboundedLaterOwner = classify({ publicOpenRecorded: true, logs: { ...listLogs, ownerOpenTimes: [laterOpen] } });
		assert.equal(unboundedLaterOwner.historyGroup, "other-unknown");
		assert.equal(unboundedLaterOwner.publicReaderOnlyBeforeFailure, undefined);
	});

	it("keeps poll stamps, later opens and missing or conflicting attribution unknown", () => {
		const ambiguous: readonly Partial<HistoryInput>[] = [
			{ logs: undefined },
			{ logs: { ...listLogs, ownerOpensCovered: false } },
			{ publicOpensCovered: false },
			{ logs: { ...listLogs, admissionCovered: false } },
			{ logs: { ...listLogs, ownerOpenTimes: [laterOpen] } },
			{ logs: { ...listLogs, ownerOpenTimes: [Date.parse(ADMITTED)] } },
			{ logs: { ...listLogs, admissionSurface: "queue-digest" } },
			{ memberships: undefined },
			{ memberships: [] },
			{ memberships: [{ savedAt: "2026-05-11T06:00:00.000Z", viewedAt: undefined }] },
			{ memberships: [...memberships, { savedAt: SAVED, viewedAt: "2026-05-10T06:00:00.000Z" }] },
			{ memberships: [{ savedAt: SAVED, viewedAt: "unparseable" }] },
			{ row: { ...row, resolutionOnViewClaimedAt: SAVED } },
			{ row: { ...row, savedAt: ADMITTED, fullCrawlRequestedAt: SAVED } },
			{ row: { ...row, fullCrawlRequestedAt: undefined } },
		];
		for (const evidence of ambiguous) assert.equal(classify(evidence).historyGroup, "other-unknown");
	});
});
