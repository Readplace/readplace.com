import assert from "node:assert/strict";
import type { MediaUploadSession } from "@packages/domain";
import { SaveAttemptIdSchema } from "@packages/domain/article";
import { UserIdSchema } from "@packages/domain/user";
import { AUDIO, UploadIdSchema } from "@packages/media-contracts";
import type { ChargedTranscript, RefundUnstartedCharge } from "@packages/provider-contracts/transcript-quota";
import { initChargeBeforeSettle } from "./charge-before-settle";
import type { ChargeDecision } from "./charge-transcript";
import type { SettleReceivedUpload } from "./commit-received-upload";

const uploadId = UploadIdSchema.parse("0123456789abcdef0123456789abcdef");
const userId = UserIdSchema.parse("00000000000000000000000000000001");
const session: MediaUploadSession = {
	uploadId,
	userId,
	kind: "audio",
	saveAttemptId: SaveAttemptIdSchema.parse("attempt-1"),
	status: "staged",
	metered: true,
};
const params = { session, kind: AUDIO, etag: '"e1"', size: 10 };
const freshCharge: ChargedTranscript = { userId, uploadId, attempt: 1, seconds: 600, day: "2026-11-07" };

function recordingRefund() {
	const refunded: ChargedTranscript[] = [];
	const refund: RefundUnstartedCharge = async (charge) => {
		refunded.push(charge);
		return { outcome: "refunded" };
	};
	return { refunded, refund };
}

function recordingSettle(settleOutcome: () => ReturnType<SettleReceivedUpload>) {
	const settled: Parameters<SettleReceivedUpload>[0][] = [];
	const settle: SettleReceivedUpload = async (settleParams) => {
		settled.push(settleParams);
		return settleOutcome();
	};
	return { settled, settle };
}

function deciding(decision: ChargeDecision) {
	return async () => decision;
}

describe("initChargeBeforeSettle", () => {
	it("settles with the seconds charged", async () => {
		const { settled, settle } = recordingSettle(async () => ({ outcome: "committed", uploadId }));
		const { refunded, refund } = recordingRefund();
		const commit = initChargeBeforeSettle({
			charge: deciding({ kind: "proceed", charge: { seconds: 600, day: "2026-11-07" }, freshCharge }),
			settle,
			refund,
		});

		assert.deepEqual(await commit(params), { outcome: "committed", uploadId });
		assert.deepEqual(settled, [{ ...params, charge: { seconds: 600, day: "2026-11-07" } }]);
		assert.deepEqual(refunded, []);
	});

	it("answers a refusal without settling", async () => {
		const { settled, settle } = recordingSettle(async () => ({ outcome: "committed", uploadId }));
		const commit = initChargeBeforeSettle({
			charge: deciding({ kind: "refuse", reason: "transcript-quota" }),
			settle,
			refund: recordingRefund().refund,
		});

		assert.deepEqual(await commit(params), { outcome: "transcript-quota" });
		assert.deepEqual(settled, []);
	});

	it("refunds a fresh charge when settling fails, and rethrows", async () => {
		const { settle } = recordingSettle(async () => {
			throw new Error("save failed");
		});
		const { refunded, refund } = recordingRefund();
		const commit = initChargeBeforeSettle({
			charge: deciding({ kind: "proceed", charge: { seconds: 600, day: "2026-11-07" }, freshCharge }),
			settle,
			refund,
		});

		await assert.rejects(commit(params), /save failed/);
		assert.deepEqual(refunded, [freshCharge]);
	});

	it("keeps an earlier charge when a retry fails to settle", async () => {
		const { settle } = recordingSettle(async () => {
			throw new Error("save failed");
		});
		const { refunded, refund } = recordingRefund();
		const commit = initChargeBeforeSettle({
			charge: deciding({ kind: "proceed", charge: { seconds: 600, day: "2026-11-07" } }),
			settle,
			refund,
		});

		await assert.rejects(commit(params), /save failed/);
		assert.deepEqual(refunded, []);
	});
});
