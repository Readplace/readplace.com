import type { UserId } from "@packages/domain/user";

export type PublishSubscriptionCancellationScheduled = (params: {
	userId: UserId;
	subscriptionId?: string;
	cancellationEffectiveAt: string;
}) => Promise<void>;
