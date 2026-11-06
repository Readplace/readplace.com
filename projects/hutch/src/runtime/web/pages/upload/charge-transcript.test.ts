import assert from "node:assert/strict";
import type { MediaUploadSession, ReadTimedDuration } from "@packages/domain";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { AUDIO, BOOK, defineMediaKind, UploadIdSchema } from "@packages/media-contracts";
import type { ChargeTranscriptQuota } from "@packages/provider-contracts/transcript-quota";
import { initChargeTranscript } from "./charge-transcript";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const userId = UserIdSchema.parse("00000000000000000000000000000001");
const METERED_AUDIO = defineMediaKind({ ...AUDIO, meter: "transcript-seconds", listenTime: (seconds) => seconds });
const session: MediaUploadSession = {
	uploadId,
	userId,
	kind: "audio",
	saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
	status: "staged",
	metered: true,
};

function readingSeconds(durationSeconds: number): ReadTimedDuration {
	return async () => ({ durationSeconds, hasAudio: true, hasVideo: false });
}

function chargeAnswering(answer: Awaited<ReturnType<ChargeTranscriptQuota>>) {
	const calls: Parameters<ChargeTranscriptQuota>[0][] = [];
	const chargeTranscriptQuota: ChargeTranscriptQuota = async (params) => {
		calls.push(params);
		return answer;
	};
	return { calls, chargeTranscriptQuota };
}

function chargeWith(params: { read: ReadTimedDuration; quota: ChargeTranscriptQuota }) {
	return initChargeTranscript({
		readDurationByMeter: new Map([["transcript-seconds" as const, params.read]]),
		chargeTranscriptQuota: params.quota,
		allowanceSeconds: 1250,
	});
}

describe("initChargeTranscript", () => {
	it("charges a metered upload its billable seconds once and keeps the charge to refund", async () => {
		const quota = chargeAnswering({ outcome: "charged", day: "2026-11-07" });
		const charge = chargeWith({ read: readingSeconds(599.2), quota: quota.chargeTranscriptQuota });

		const decision = await charge({ session, kind: METERED_AUDIO, etag: '"e1"' });

		const ref = { userId, uploadId, attempt: 1 };
		assert.deepEqual(quota.calls, [{ ...ref, seconds: 600 }]);
		assert.deepEqual(decision, {
			kind: "proceed",
			chargedSeconds: 600,
			freshCharge: { ...ref, seconds: 600, day: "2026-11-07" },
		});
	});

	it("proceeds without a fresh charge when the commit was already charged", async () => {
		const quota = chargeAnswering({ outcome: "already-charged" });
		const charge = chargeWith({ read: readingSeconds(600), quota: quota.chargeTranscriptQuota });

		assert.deepEqual(await charge({ session, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "proceed",
			chargedSeconds: 600,
		});
	});

	it("refuses when the day's allowance is spent or the ledger finds the file too long", async () => {
		const spent = chargeWith({ read: readingSeconds(600), quota: chargeAnswering({ outcome: "day-spent" }).chargeTranscriptQuota });
		const over = chargeWith({
			read: readingSeconds(600),
			quota: chargeAnswering({ outcome: "over-allowance" }).chargeTranscriptQuota,
		});

		assert.deepEqual(await spent({ session, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "refuse",
			reason: "transcript-quota",
		});
		assert.deepEqual(await over({ session, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "refuse",
			reason: "transcript-too-long",
		});
	});

	it("refuses a file longer than the allowance without charging", async () => {
		const quota = chargeAnswering({ outcome: "charged", day: "2026-11-07" });
		const charge = chargeWith({ read: readingSeconds(1250.5), quota: quota.chargeTranscriptQuota });

		assert.deepEqual(await charge({ session, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "refuse",
			reason: "transcript-too-long",
		});
		assert.deepEqual(quota.calls, []);
	});

	it("refuses audio it cannot read or that is not playable audio, without charging", async () => {
		const quota = chargeAnswering({ outcome: "charged", day: "2026-11-07" });
		const unreadable = chargeWith({ read: async () => ({ unreadable: true }), quota: quota.chargeTranscriptQuota });
		const video = chargeWith({
			read: async () => ({ durationSeconds: 600, hasAudio: true, hasVideo: true }),
			quota: quota.chargeTranscriptQuota,
		});

		assert.deepEqual(await unreadable({ session, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "refuse",
			reason: "unreadable-audio",
		});
		assert.deepEqual(await video({ session, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "refuse",
			reason: "unreadable-audio",
		});
		assert.deepEqual(quota.calls, []);
	});

	it("refuses with the reason the kind's own timed facts judgement gives, without charging", async () => {
		const quota = chargeAnswering({ outcome: "charged", day: "2026-11-07" });
		const charge = chargeWith({ read: readingSeconds(600), quota: quota.chargeTranscriptQuota });
		const silent = defineMediaKind({ ...METERED_AUDIO, refuseTimedFacts: () => "no-audio-track" as const });

		assert.deepEqual(await charge({ session, kind: silent, etag: '"e1"' }), {
			kind: "refuse",
			reason: "no-audio-track",
		});
		assert.deepEqual(quota.calls, []);
	});

	it("does not read or charge an unflagged upload or a kind without a meter", async () => {
		const quota = chargeAnswering({ outcome: "charged", day: "2026-11-07" });
		const read: ReadTimedDuration = async () => assert.fail("an unmetered upload is never read");
		const charge = chargeWith({ read, quota: quota.chargeTranscriptQuota });

		assert.deepEqual(await charge({ session: { ...session, metered: undefined }, kind: METERED_AUDIO, etag: '"e1"' }), {
			kind: "proceed",
		});
		assert.deepEqual(await charge({ session, kind: BOOK, etag: '"e1"' }), { kind: "proceed" });
		assert.deepEqual(quota.calls, []);
	});
});
