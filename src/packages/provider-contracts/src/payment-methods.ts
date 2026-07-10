import { z } from "zod";

export const PaymentMethodIdSchema = z.string().brand<"PaymentMethodId">();
export type PaymentMethodId = z.infer<typeof PaymentMethodIdSchema>;

export const CardSetupIdSchema = z.string().min(1).brand<"CardSetupId">();
export type CardSetupId = z.infer<typeof CardSetupIdSchema>;

export type CardSetupStatus = "succeeded" | "processing" | "failed";

export interface CardSetupResult {
	status: CardSetupStatus;
	customerId: string | undefined;
	cardId: PaymentMethodId | undefined;
	failureReason: string | undefined;
}

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
}) => Promise<{ clientSecret: string; setupId: CardSetupId }>;

export type GetCardSetupResult = (input: {
	setupId: CardSetupId;
}) => Promise<CardSetupResult>;

export type RemoveCard = (input: {
	customerId: string;
	cardId: PaymentMethodId;
}) => Promise<void>;

export type SetPrimaryCard = (input: {
	customerId: string;
	cardId: PaymentMethodId;
	subscriptionId?: string;
}) => Promise<void>;
