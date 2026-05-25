import type { UserId } from "@packages/domain/user";

export type PublishAddPaymentMethodCommand = (params: {
	userId: UserId;
	customerId: string;
	paymentMethodId: string;
	brand: string;
	last4: string;
}) => Promise<void>;
