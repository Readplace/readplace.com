import type { UserId } from "@packages/domain/user";

export type PublishSubscriptionReactivated = (params: {
	userId: UserId;
	subscriptionId?: string;
}) => Promise<void>;
