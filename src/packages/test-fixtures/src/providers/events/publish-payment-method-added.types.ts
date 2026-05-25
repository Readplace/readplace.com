import type { UserId } from "@packages/domain/user";

export type PublishPaymentMethodAdded = (params: {
	userId: UserId;
}) => Promise<void>;
