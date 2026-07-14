import type { UserId } from "@packages/domain/user";
import type { HutchLogger } from "@packages/hutch-logger";
import type {
	FindSubscriptionNextCharge,
	SubscriptionNextCharge,
} from "@packages/provider-contracts/subscription-billing";
import type {
	SetSubscriptionNextCharge,
	SubscriptionRecord,
} from "@packages/provider-contracts/subscription-providers";

export type LoadNextCharge = (input: {
	userId: UserId;
	row: SubscriptionRecord | undefined;
	suppressed: boolean;
}) => Promise<SubscriptionNextCharge | undefined>;

/**
 * Reads the renewal through the subscription row, falling back to the provider and
 * writing what it learns back. The row is a cache with exactly one invalidation
 * rule — a charge in the past — which makes the pair self-healing: the stored value
 * can only be wrong in the window between a renewal and the next visit, and that
 * visit repairs it. In the common case (an annual subscription, most of the year)
 * nothing is fetched at all.
 *
 * Nothing here throws. A renewal date is decoration on a page a reader may be
 * visiting *because* their billing is already broken, so a provider outage costs
 * them the line and nothing else.
 */
export function initLoadNextCharge(deps: {
	findSubscriptionNextCharge: FindSubscriptionNextCharge;
	setSubscriptionNextCharge: SetSubscriptionNextCharge;
	logger: HutchLogger;
	now: () => Date;
}): LoadNextCharge {
	return async ({ userId, row, suppressed }) => {
		if (suppressed || row?.status !== "active") return undefined;

		const subscriptionId = row.subscriptionId;
		if (subscriptionId === undefined) return undefined;

		/* Phrased as "is it still in the future?" rather than "is it stale?" so an
		 * unparseable stored date is NaN, fails the comparison, and refetches — the
		 * corrupt case needs no branch of its own. */
		const stored = row.nextCharge;
		if (stored !== undefined && Date.parse(stored.at) > deps.now().getTime()) {
			return stored;
		}

		try {
			const nextCharge = await deps.findSubscriptionNextCharge({ subscriptionId });
			if (nextCharge === undefined) return undefined;

			await deps.setSubscriptionNextCharge({ userId, subscriptionId, nextCharge });
			return nextCharge;
		} catch (error) {
			deps.logger.error("[account/next-charge] live read failed", {
				userId,
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	};
}
