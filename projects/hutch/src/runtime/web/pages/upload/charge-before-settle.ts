import type { RefundUnstartedCharge } from "@packages/provider-contracts/transcript-quota";
import type { ChargeTranscript } from "./charge-transcript";
import type { SettleReceivedUpload } from "./commit-received-upload";

export function initChargeBeforeSettle(deps: {
	charge: ChargeTranscript;
	settle: SettleReceivedUpload;
	refund: RefundUnstartedCharge;
}): SettleReceivedUpload {
	return async (params) => {
		const decision = await deps.charge(params);
		if (decision.kind === "refuse") return { outcome: decision.reason };
		try {
			return await deps.settle({ ...params, charge: decision.charge });
		} catch (error) {
			if (decision.freshCharge) await deps.refund(decision.freshCharge);
			throw error;
		}
	};
}
