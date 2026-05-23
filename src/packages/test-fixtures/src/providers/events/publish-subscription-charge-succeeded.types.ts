import type { UserId } from "@packages/domain/user";

export type PublishSubscriptionChargeSucceeded = (params: {
	userId: UserId;
	subscriptionId: string;
	customerId: string;
}) => Promise<void>;
