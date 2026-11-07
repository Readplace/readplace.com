import assert from "node:assert/strict";
import type { RefreshArticleContentSkipReason } from "@packages/infra-components";
import { decideRefreshSkip, type RefreshAdmissionRow } from "./decide-refresh-skip";

const T = "2026-05-10T12:00:00.000Z";
const T_PLUS_SECOND = "2026-05-10T12:00:01.000Z";
const T_PLUS_MINUTE = "2026-05-10T12:01:00.000Z";
const T_PLUS_HOUR = "2026-05-10T13:00:00.000Z";
const T_MINUS_DAY = "2026-05-09T12:00:00.000Z";

const scenarios: Array<{ scenario: string; row: RefreshAdmissionRow | undefined; expected: RefreshArticleContentSkipReason | undefined }> = [
	{ scenario: "no row", row: undefined, expected: undefined },
	{ scenario: "purged, even if otherwise newer than nothing", row: { purgedAt: T_MINUS_DAY, crawlStatus: "ready" }, expected: "purged" },
	{ scenario: "failed with older content (the heal plan 18 keeps)", row: { crawlStatus: "failed", contentFetchedAt: T_MINUS_DAY }, expected: undefined },
	{ scenario: "failed with later content", row: { crawlStatus: "failed", contentFetchedAt: T_PLUS_HOUR }, expected: "superseded" },
	{ scenario: "unsupported", row: { crawlStatus: "unsupported", contentFetchedAt: T_MINUS_DAY }, expected: "unsupported" },
	{ scenario: "later content", row: { crawlStatus: "ready", contentFetchedAt: T_PLUS_HOUR }, expected: "superseded" },
	{ scenario: "same T (run twice)", row: { crawlStatus: "ready", contentFetchedAt: T }, expected: "superseded" },
	{ scenario: "older content", row: { crawlStatus: "ready", contentFetchedAt: T_MINUS_DAY }, expected: undefined },
	{ scenario: "revived after T, crawl marked pending", row: { crawlStatus: "pending", savedAt: T_PLUS_SECOND }, expected: "superseded" },
	{ scenario: "revived after T, fetch timestamp landed", row: { crawlStatus: "pending", contentFetchedAt: T_PLUS_HOUR, savedAt: T_PLUS_SECOND }, expected: "superseded" },
	{ scenario: "empty string is no clock", row: { crawlStatus: "ready", contentFetchedAt: "" }, expected: undefined },
	{ scenario: "no clock, saved before T", row: { crawlStatus: "ready", savedAt: T_MINUS_DAY }, expected: undefined },
	{ scenario: "no clock, saved after T (revived, or a co-save)", row: { crawlStatus: "ready", savedAt: T_PLUS_MINUTE }, expected: "superseded" },
	{ scenario: "no clock, attempt in flight, saved before T", row: { crawlStatus: "pending", savedAt: T_MINUS_DAY }, expected: undefined },
	{ scenario: "revived after T, pending not yet marked", row: { savedAt: T_PLUS_SECOND }, expected: "superseded" },
	{ scenario: "legacy row with no clock and no savedAt", row: {}, expected: undefined },
	{ scenario: "attempt in flight, clock older than T", row: { crawlStatus: "pending", contentFetchedAt: T_MINUS_DAY }, expected: undefined },
	{ scenario: "recrawl whose live leg failed, canonical retained", row: { crawlStatus: "ready", contentFetchedAt: "1970-01-01T00:00:00.000Z" }, expected: undefined },
	{ scenario: "clocked row saved after T is judged by the clock", row: { crawlStatus: "ready", contentFetchedAt: T_MINUS_DAY, savedAt: T_PLUS_MINUTE }, expected: undefined },
];

describe("decideRefreshSkip", () => {
	it.each(scenarios)("$scenario", ({ row, expected }) => {
		assert.equal(decideRefreshSkip({ row, messageFetchedAt: T }), expected);
	});
});
