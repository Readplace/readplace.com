import type { UserId } from "@packages/domain/user";
import type {
	ClaimReaderReadyEmailSlot,
	DeleteReaderReadyState,
	ReleaseReaderReadyEmailSlot,
} from "@packages/provider-contracts/reader-ready-state";

interface Claim {
	claimedAt: string;
	messageId: string;
}

export function initInMemoryReaderReadyState(): {
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	deleteReaderReadyState: DeleteReaderReadyState;
} {
	const claimByUser = new Map<UserId, Claim>();

	const claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot = async ({
		userId,
		now,
		cooldownMs,
		messageId,
	}) => {
		const cutoff = new Date(now.getTime() - cooldownMs);
		const last = claimByUser.get(userId);
		if (last !== undefined && last.messageId === messageId) {
			claimByUser.set(userId, { claimedAt: now.toISOString(), messageId });
			return { claimed: true, redelivery: true, claimedAt: new Date(last.claimedAt) };
		}
		if (last === undefined || new Date(last.claimedAt) < cutoff) {
			claimByUser.set(userId, { claimedAt: now.toISOString(), messageId });
			return { claimed: true, redelivery: false };
		}
		return { claimed: false };
	};

	const releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot = async ({
		userId,
		claimedAt,
		messageId,
	}) => {
		const last = claimByUser.get(userId);
		if (last?.claimedAt === claimedAt.toISOString() && last.messageId === messageId) {
			claimByUser.delete(userId);
		}
	};

	const deleteReaderReadyState: DeleteReaderReadyState = async (userId) => {
		claimByUser.delete(userId);
	};

	return { claimReaderReadyEmailSlot, releaseReaderReadyEmailSlot, deleteReaderReadyState };
}
