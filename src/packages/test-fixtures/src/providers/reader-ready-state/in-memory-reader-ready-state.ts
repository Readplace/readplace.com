import type { UserId } from "@packages/domain/user";
import type { ClaimReaderReadyEmailSlot } from "./reader-ready-state.types";

export function initInMemoryReaderReadyState(): {
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
} {
	const lastSentByUser = new Map<UserId, string>();

	const claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot = async ({ userId, now, cooldownMs }) => {
		const cutoff = new Date(now.getTime() - cooldownMs);
		const last = lastSentByUser.get(userId);
		if (last === undefined || new Date(last) < cutoff) {
			lastSentByUser.set(userId, now.toISOString());
			return true;
		}
		return false;
	};

	return { claimReaderReadyEmailSlot };
}
