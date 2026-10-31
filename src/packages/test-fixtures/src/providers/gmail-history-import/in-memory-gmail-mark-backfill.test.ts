import assert from "node:assert/strict";
import { ForwardableSenderSchema, GmailAccountEmailSchema } from "@packages/domain/gmail";
import { UserIdSchema } from "@packages/domain/user";
import { initInMemoryGmailMarkBackfill } from "./in-memory-gmail-mark-backfill";

const REF = {
	userId: UserIdSchema.parse("user-1"),
	accountEmail: GmailAccountEmailSchema.parse("reader@gmail.com"),
	senderEmail: ForwardableSenderSchema.parse("dan@tldr.tech"),
};
const ENABLED_AT = "2026-10-30T00:00:00.000Z";
const NOW = new Date("2026-10-31T00:00:00.000Z");
const COUNTS = { marked: 2, alreadyMarked: 1, notFound: 0, unlocatable: 0, notSaved: 1, failed: 0 };

async function started() {
	const backfills = initInMemoryGmailMarkBackfill();
	const start = await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW });
	assert.equal(start.started, true);
	return backfills;
}

describe("initInMemoryGmailMarkBackfill", () => {
	it("starts, claims, saves and completes a job page by page", async () => {
		const backfills = await started();
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 0, now: NOW }), true);
		assert.equal(await backfills.savePage({ ...REF, generation: 1, page: 0, cursor: "c1", counts: COUNTS, now: NOW }), true);
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 1, now: NOW }), true);
		assert.equal(await backfills.complete({ ...REF, generation: 1, page: 1, counts: COUNTS, now: NOW }), true);
		const job = await backfills.findBackfill(REF);
		assert.deepEqual(
			{ state: job?.state, page: job?.page, cursor: job?.cursor, counts: job?.counts, finishedAt: job?.finishedAt },
			{ state: "complete", page: 1, cursor: "c1", counts: { marked: 4, alreadyMarked: 2, notFound: 0, unlocatable: 0, notSaved: 2, failed: 0 }, finishedAt: NOW.toISOString() },
		);
		assert.deepEqual(await backfills.listBackfillsByUserId(REF.userId), [job]);
	});

	it("refuses a second start while the job is still queued", async () => {
		const backfills = await started();
		assert.deepEqual(await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW }), { started: false });
	});

	it("refuses a claim while another lease is live, and grants it once the lease expires", async () => {
		const backfills = await started();
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 0, now: NOW }), true);
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 0, now: new Date(NOW.getTime() + 59_999) }), false);
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 0, now: new Date(NOW.getTime() + 60_000) }), true);
	});

	it("refuses a claim for a stale generation, another page or a finished job", async () => {
		const backfills = await started();
		assert.equal(await backfills.claimPage({ ...REF, generation: 2, page: 0, now: NOW }), false);
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 1, now: NOW }), false);
		await backfills.cancelBackfill({ ...REF, generation: undefined, reason: "option-off", now: NOW });
		assert.equal(await backfills.claimPage({ ...REF, generation: 1, page: 0, now: NOW }), false);
	});

	it("refuses to save or complete a page that is not claimed", async () => {
		const backfills = await started();
		assert.equal(await backfills.savePage({ ...REF, generation: 1, page: 0, cursor: "c1", counts: COUNTS, now: NOW }), false);
		assert.equal(await backfills.complete({ ...REF, generation: 1, page: 0, counts: COUNTS, now: NOW }), false);
	});

	it("fails an unfinished job of the given generation or of any generation", async () => {
		const backfills = await started();
		assert.equal(await backfills.failBackfill({ ...REF, generation: 2, reason: "dead-lettered", now: NOW }), "unchanged");
		assert.equal(await backfills.failBackfill({ ...REF, generation: undefined, reason: "permission-revoked", now: NOW }), "failed");
		assert.equal((await backfills.findBackfill(REF))?.failureReason, "permission-revoked");
		assert.equal(await backfills.failBackfill({ ...REF, generation: 1, reason: "dead-lettered", now: NOW }), "unchanged");
	});

	it("restarts a failed job where it stopped", async () => {
		const backfills = await started();
		await backfills.claimPage({ ...REF, generation: 1, page: 0, now: NOW });
		await backfills.savePage({ ...REF, generation: 1, page: 0, cursor: "c1", counts: COUNTS, now: NOW });
		await backfills.failBackfill({ ...REF, generation: 1, reason: "gmail-rejected", now: NOW });
		const restart = await backfills.startBackfill({ ...REF, optionEnabledAt: ENABLED_AT, now: NOW });
		assert.deepEqual(restart.started && { generation: restart.job.generation, page: restart.job.page, cursor: restart.job.cursor }, {
			generation: 2,
			page: 1,
			cursor: "c1",
		});
	});

	it("cancels an unfinished job once", async () => {
		const backfills = await started();
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: undefined, reason: "mapping-removed", now: NOW }), "cancelled");
		assert.equal((await backfills.findBackfill(REF))?.cancelReason, "mapping-removed");
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: undefined, reason: "mapping-removed", now: NOW }), "unchanged");
	});

	it("cancels an unfinished job only of the given generation", async () => {
		const backfills = await started();
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: 2, reason: "option-off", now: NOW }), "unchanged");
		assert.equal(await backfills.cancelBackfill({ ...REF, generation: 1, reason: "option-off", now: NOW }), "cancelled");
	});
});
