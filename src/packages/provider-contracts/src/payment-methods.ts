import { z } from "zod";

export const PaymentMethodIdSchema = z.string().brand<"PaymentMethodId">();
export type PaymentMethodId = z.infer<typeof PaymentMethodIdSchema>;

export interface SavedCard {
	id: PaymentMethodId;
	brand: string;
	last4: string;
	expMonth: number;
	expYear: number;
	isPrimary: boolean;
}

export type ListCards = (input: {
	customerId: string;
	subscriptionId?: string;
}) => Promise<SavedCard[]>;

export type BeginAddCard = (input: {
	customerId: string;
}) => Promise<{ clientSecret: string }>;

export type RemoveCard = (input: {
	customerId: string;
	cardId: PaymentMethodId;
}) => Promise<void>;

export type SetPrimaryCard = (input: {
	customerId: string;
	cardId: PaymentMethodId;
	subscriptionId?: string;
}) => Promise<void>;
