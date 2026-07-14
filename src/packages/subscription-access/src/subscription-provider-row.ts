import { dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionNextChargeSchema } from "@packages/provider-contracts/subscription-billing";
import {
	type SubscriptionRecord,
	SubscriptionProviderSchema,
} from "@packages/provider-contracts/subscription-providers";

export const SubscriptionProviderRow = z.object({
	userId: UserIdSchema,
	provider: SubscriptionProviderSchema,
	subscriptionId: dynamoField(z.string()),
	customerId: dynamoField(z.string()),
	status: z.enum(["trialing", "active", "pending_cancellation", "cancelled"]),
	trialEndsAt: dynamoField(z.string()),
	cancellationEffectiveAt: dynamoField(z.string()),
	trialFeedbackEmailSentAt: dynamoField(z.string()),
	trialReminderEmailSentAt: dynamoField(z.string()),
	/* `.catch` degrades a malformed map to `undefined` rather than throwing. Every
	 * read of this row runs through `schema.parse`, and that read feeds the save
	 * gate and the header banner — a strict parse here would turn one bad attribute
	 * into a total account outage for the sake of a cosmetic line. */
	nextCharge: dynamoField(SubscriptionNextChargeSchema.optional().catch(undefined)),
	createdAt: z.string(),
	updatedAt: z.string(),
});

export function toRecord(row: z.infer<typeof SubscriptionProviderRow>): SubscriptionRecord {
	return {
		userId: row.userId,
		provider: row.provider,
		...(row.subscriptionId !== undefined ? { subscriptionId: row.subscriptionId } : {}),
		...(row.customerId !== undefined ? { customerId: row.customerId } : {}),
		status: row.status,
		...(row.trialEndsAt !== undefined ? { trialEndsAt: row.trialEndsAt } : {}),
		...(row.cancellationEffectiveAt !== undefined
			? { cancellationEffectiveAt: row.cancellationEffectiveAt }
			: {}),
		...(row.trialFeedbackEmailSentAt !== undefined
			? { trialFeedbackEmailSentAt: row.trialFeedbackEmailSentAt }
			: {}),
		...(row.trialReminderEmailSentAt !== undefined
			? { trialReminderEmailSentAt: row.trialReminderEmailSentAt }
			: {}),
		...(row.nextCharge !== undefined ? { nextCharge: row.nextCharge } : {}),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
