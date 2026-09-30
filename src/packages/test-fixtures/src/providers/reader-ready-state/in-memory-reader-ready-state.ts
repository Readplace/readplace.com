import type { UserId } from "@packages/domain/user";
import type {
	ClaimReaderReadyEmailSlot,
	DeleteReaderReadyState,
	FindReaderReadyEmailState,
	ReleaseReaderReadyEmailSlot,
} from "@packages/provider-contracts/reader-ready-state";

interface Claim {
	claimedAt: string;
	messageId: string;
	urls: readonly string[];
}

export function initInMemoryReaderReadyState(): {
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	findReaderReadyEmailState: FindReaderReadyEmailState;
	deleteReaderReadyState: DeleteReaderReadyState;
} {
	const claimByUser = new Map<UserId, Claim>();

	const claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot = async ({
		userId,
		now,
		cooldownMs,
		messageId,
		urls,
	}) => {
		const cutoff = new Date(now.getTime() - cooldownMs);
		const last = claimByUser.get(userId);
		if (last === undefined || new Date(last.claimedAt) < cutoff) {
			claimByUser.set(userId, { claimedAt: now.toISOString(), messageId, urls });
			return { claimed: true, redelivery: false };
		}
		if (last.messageId !== messageId) return { claimed: false };
		// Left untouched: the stored instant must keep pointing at the send it anchors.
		return { claimed: true, redelivery: true, claimedAt: new Date(last.claimedAt), urls: last.urls };
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

	const findReaderReadyEmailState: FindReaderReadyEmailState = async (userId) => {
		const last = claimByUser.get(userId);
		if (last === undefined) return { lastSentAt: undefined, lastMessageId: undefined };
		return { lastSentAt: new Date(last.claimedAt), lastMessageId: last.messageId };
	};

	const deleteReaderReadyState: DeleteReaderReadyState = async (userId) => {
		claimByUser.delete(userId);
	};

	return {
		claimReaderReadyEmailSlot,
		releaseReaderReadyEmailSlot,
		findReaderReadyEmailState,
		deleteReaderReadyState,
	};
}
