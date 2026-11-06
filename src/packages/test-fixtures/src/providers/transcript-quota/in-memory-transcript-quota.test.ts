import assert from "node:assert/strict";
import {
	initInMemoryTranscriptCharge,
	initInMemoryTranscriptLedger,
	initInMemoryTranscriptQuotaRows,
} from "./in-memory-transcript-quota";

const REF = { userId: "user-1", uploadId: "upload-1", attempt: 1 };
const DAY = "2026-11-06";

function createQuota(startIso = "2026-11-06T10:00:00.000Z") {
	let now = new Date(startIso);
	const rows = initInMemoryTranscriptQuotaRows();
	const { chargeTranscriptQuota } = initInMemoryTranscriptCharge({ rows, allowanceSeconds: 1250, now: () => now });
	const ledger = initInMemoryTranscriptLedger({ rows });
	return {
		...ledger,
		chargeTranscriptQuota,
		spentOn: (day: string) => rows.spentSeconds.get(`user-1#${day}`),
		setNow: (iso: string) => {
			now = new Date(iso);
		},
	};
}

describe("in-memory transcript charge", () => {
	it("charges the day the clock is on", async () => {
		const quota = createQuota();

		assert.deepEqual(await quota.chargeTranscriptQuota({ ...REF, seconds: 600 }), { outcome: "charged", day: DAY });
		assert.equal(quota.spentOn(DAY), 600);
	});

	it("refuses a file longer than the whole allowance", async () => {
		const quota = createQuota();

		assert.deepEqual(await quota.chargeTranscriptQuota({ ...REF, seconds: 1251 }), { outcome: "over-allowance" });
		assert.equal(quota.spentOn(DAY), undefined);
	});

	it("answers already-charged for a redelivered commit", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });

		assert.deepEqual(await quota.chargeTranscriptQuota({ ...REF, seconds: 600 }), { outcome: "already-charged" });
		assert.equal(quota.spentOn(DAY), 600);
	});

	it("answers day-spent once the day cannot take the file, and charges again the next day", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });
		await quota.chargeTranscriptQuota({ ...REF, uploadId: "upload-2", seconds: 600 });

		assert.deepEqual(await quota.chargeTranscriptQuota({ ...REF, uploadId: "upload-3", seconds: 600 }), {
			outcome: "day-spent",
		});
		quota.setNow("2026-11-07T00:00:00.000Z");
		assert.deepEqual(await quota.chargeTranscriptQuota({ ...REF, uploadId: "upload-3", seconds: 600 }), {
			outcome: "charged",
			day: "2026-11-07",
		});
	});

	it("charges a refunded row again", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });
		await quota.refundUnstartedCharge({ ...REF, seconds: 600, day: DAY });

		assert.deepEqual(await quota.chargeTranscriptQuota({ ...REF, seconds: 600 }), { outcome: "charged", day: DAY });
		assert.equal(quota.spentOn(DAY), 600);
	});
});

describe("in-memory transcript ledger", () => {
	const CHARGED = { ...REF, seconds: 600, day: DAY };

	it("marks a reserved charge started, and a started one again", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });

		assert.deepEqual(await quota.markTranscriptStarted(REF), { outcome: "done" });
		assert.deepEqual(await quota.markTranscriptStarted(REF), { outcome: "done" });
	});

	it("settles an open charge and closes every later state change", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });

		assert.deepEqual(await quota.settleTranscriptCharge(REF), { outcome: "done" });
		assert.deepEqual(await quota.settleTranscriptCharge(REF), { outcome: "closed" });
		assert.deepEqual(await quota.markTranscriptStarted(REF), { outcome: "closed" });
		assert.deepEqual(await quota.refundTranscriptCharge(CHARGED), { outcome: "closed" });
		assert.deepEqual(await quota.refundUnstartedCharge(CHARGED), { outcome: "closed" });
		assert.equal(quota.spentOn(DAY), 600);
	});

	it("refunds a started charge through the failure route and gives its seconds back", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });
		await quota.markTranscriptStarted(REF);

		assert.deepEqual(await quota.refundTranscriptCharge(CHARGED), { outcome: "refunded" });
		assert.equal(quota.spentOn(DAY), 0);
		assert.deepEqual(await quota.markTranscriptStarted(REF), { outcome: "closed" });
	});

	it("leaves a started charge and its seconds alone on a request-path refund", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });
		await quota.markTranscriptStarted(REF);

		assert.deepEqual(await quota.refundUnstartedCharge(CHARGED), { outcome: "started" });
		assert.equal(quota.spentOn(DAY), 600);
		assert.deepEqual(await quota.settleTranscriptCharge(REF), { outcome: "done" });
	});

	it("refunds a reserved charge on the request path", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });

		assert.deepEqual(await quota.refundUnstartedCharge(CHARGED), { outcome: "refunded" });
		assert.equal(quota.spentOn(DAY), 0);
	});

	it("answers closed on every state port once the account's rows are deleted", async () => {
		const quota = createQuota();
		await quota.chargeTranscriptQuota({ ...REF, seconds: 600 });
		await quota.chargeTranscriptQuota({ ...REF, userId: "user-10", seconds: 600 });

		await quota.deleteAllTranscriptQuota({ userId: "user-1" });

		assert.equal(quota.spentOn(DAY), undefined);
		assert.deepEqual(await quota.markTranscriptStarted(REF), { outcome: "closed" });
		assert.deepEqual(await quota.settleTranscriptCharge(REF), { outcome: "closed" });
		assert.deepEqual(await quota.refundTranscriptCharge(CHARGED), { outcome: "closed" });
		assert.deepEqual(await quota.refundUnstartedCharge(CHARGED), { outcome: "closed" });
		assert.deepEqual(await quota.settleTranscriptCharge({ ...REF, userId: "user-10" }), { outcome: "done" });
	});
});
