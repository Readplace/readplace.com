import type { UserId } from "@packages/domain/user";

export type PublishSubscriptionStartRequestCommand = (params: {
	userId: UserId;
}) => Promise<void>;
