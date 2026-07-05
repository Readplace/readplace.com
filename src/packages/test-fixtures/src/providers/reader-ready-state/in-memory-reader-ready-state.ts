import type { UserId } from "@packages/domain/user";
import type {
	ClaimReaderReadyEmailSlot,
	DeleteReaderReadyState,
	ReleaseReaderReadyEmailSlot,
} from "@packages/provider-contracts/reader-ready-state";

export function initInMemoryReaderReadyState(): {
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	deleteReaderReadyState: DeleteReaderReadyState;
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

	const releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot = async ({ userId, claimedAt }) => {
		if (lastSentByUser.get(userId) === claimedAt.toISOString()) {
			lastSentByUser.delete(userId);
		}
	};

	const deleteReaderReadyState: DeleteReaderReadyState = async (userId) => {
		lastSentByUser.delete(userId);
	};

	return { claimReaderReadyEmailSlot, releaseReaderReadyEmailSlot, deleteReaderReadyState };
}
