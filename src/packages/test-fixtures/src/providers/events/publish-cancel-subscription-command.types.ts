import type { UserId } from "@packages/domain/user";

export type PublishCancelSubscriptionCommand = (params: {
	userId: UserId;
}) => Promise<void>;
