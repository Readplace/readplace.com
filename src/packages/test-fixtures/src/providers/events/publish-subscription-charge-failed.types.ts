import type { UserId } from "@packages/domain/user";

export type SubscriptionChargeFailedReason = "no_card_on_file" | "stripe_error";

export type PublishSubscriptionChargeFailed = (params: {
	userId: UserId;
	reason: SubscriptionChargeFailedReason;
}) => Promise<void>;
