import assert from "node:assert/strict";
import { UserIdSchema } from "../user";
import { ForwardableSenderSchema } from "./build-forwarding-filter-query";
import { GmailAccountEmailSchema } from "./gmail-account-email.schema";
import {
	addGmailMarkBackfillCounts,
	type GmailMarkBackfillJob,
	planGmailMarkBackfillStart,
	ZERO_GMAIL_MARK_BACKFILL_COUNTS,
} from "./gmail-mark-backfill";

const ref = {
	userId: UserIdSchema.parse("user-1"),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	senderEmail: ForwardableSenderSchema.parse("dan@tldr.tech"),
};
const ENABLED_AT = "2026-10-30T00:00:00.000Z";
const NOW = new Date("2026-10-31T00:00:00.000Z");

function job(overrides: Partial<GmailMarkBackfillJob>): GmailMarkBackfillJob {
	return {
		...ref,
		optionEnabledAt: ENABLED_AT,
		generation: 3,
		page: 4,
		cursor: "2026-10-01T00:00:00.000Z#<a@tldr.tech>",
		state: "failed",
		counts: { marked: 5, alreadyMarked: 1, notFound: 2, unlocatable: 0, notSaved: 1, failed: 0 },
		failureReason: "gmail-rejected",
		cancelReason: undefined,
		startedAt: "2026-10-30T01:00:00.000Z",
		updatedAt: "2026-10-30T02:00:00.000Z",
		finishedAt: undefined,
		...overrides,
	};
}

describe("planGmailMarkBackfillStart", () => {
	it("starts a fresh job at generation 1 when there is none", () => {
		assert.deepEqual(planGmailMarkBackfillStart({ existing: undefined, ref, optionEnabledAt: ENABLED_AT, now: NOW }), {
			...ref,
			optionEnabledAt: ENABLED_AT,
			generation: 1,
			page: 0,
			cursor: undefined,
			state: "queued",
			counts: ZERO_GMAIL_MARK_BACKFILL_COUNTS,
			failureReason: undefined,
			cancelReason: undefined,
			startedAt: NOW.toISOString(),
			updatedAt: NOW.toISOString(),
			finishedAt: undefined,
		});
	});

	it("starts over from the first page when the job belongs to an earlier on-period", () => {
		const started = planGmailMarkBackfillStart({
			existing: job({ optionEnabledAt: "2026-10-01T00:00:00.000Z", state: "complete" }),
			ref,
			optionEnabledAt: ENABLED_AT,
			now: NOW,
		});
		assert.deepEqual(
			{ generation: started?.generation, page: started?.page, cursor: started?.cursor, counts: started?.counts, optionEnabledAt: started?.optionEnabledAt },
			{ generation: 4, page: 0, cursor: undefined, counts: ZERO_GMAIL_MARK_BACKFILL_COUNTS, optionEnabledAt: ENABLED_AT },
		);
	});

	it("resumes a failed job of the same on-period where it stopped", () => {
		assert.deepEqual(planGmailMarkBackfillStart({ existing: job({}), ref, optionEnabledAt: ENABLED_AT, now: NOW }), {
			...job({}),
			generation: 4,
			state: "queued",
			failureReason: undefined,
			updatedAt: NOW.toISOString(),
		});
	});

	it("resumes a cancelled job of the same on-period and clears why it was cancelled", () => {
		const started = planGmailMarkBackfillStart({
			existing: job({ state: "cancelled", failureReason: undefined, cancelReason: "disconnected" }),
			ref,
			optionEnabledAt: ENABLED_AT,
			now: NOW,
		});
		assert.deepEqual({ state: started?.state, cancelReason: started?.cancelReason, page: started?.page }, { state: "queued", cancelReason: undefined, page: 4 });
	});

	it.each(["queued", "running", "complete"] as const)("refuses to restart a %s job of the same on-period", (state) => {
		assert.equal(planGmailMarkBackfillStart({ existing: job({ state }), ref, optionEnabledAt: ENABLED_AT, now: NOW }), undefined);
	});
});

describe("addGmailMarkBackfillCounts", () => {
	it("adds every count", () => {
		assert.deepEqual(
			addGmailMarkBackfillCounts({
				base: { marked: 1, alreadyMarked: 2, notFound: 3, unlocatable: 4, notSaved: 5, failed: 6 },
				added: { marked: 10, alreadyMarked: 20, notFound: 30, unlocatable: 40, notSaved: 50, failed: 60 },
			}),
			{ marked: 11, alreadyMarked: 22, notFound: 33, unlocatable: 44, notSaved: 55, failed: 66 },
		);
	});
});
