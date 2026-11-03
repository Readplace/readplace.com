import { dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import { SubscriptionNextChargeSchema } from "@packages/provider-contracts/subscription-billing";
import {
	type SubscriptionRecord,
	BillingPlanSchema,
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
	automationSavesHeldEmailSentAt: dynamoField(z.string()),
	payDigestEmailSentAt: dynamoField(z.string()),
	payDigestMessageId: dynamoField(z.string()),
	payDigestUrls: dynamoField(z.array(z.string())),
	trialDay3EmailSentAt: dynamoField(z.string()),
	trialDay3EmailMessageId: dynamoField(z.string()),
	trialDay7EmailSentAt: dynamoField(z.string()),
	trialDay7EmailMessageId: dynamoField(z.string()),
	founderNoteSentAt: dynamoField(z.string()),
	plan: dynamoField(BillingPlanSchema.optional().catch(undefined)),
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
		...(row.automationSavesHeldEmailSentAt !== undefined
			? { automationSavesHeldEmailSentAt: row.automationSavesHeldEmailSentAt }
			: {}),
		...(row.payDigestEmailSentAt !== undefined
			? { payDigestEmailSentAt: row.payDigestEmailSentAt }
			: {}),
		...(row.payDigestMessageId !== undefined
			? { payDigestMessageId: row.payDigestMessageId }
			: {}),
		...(row.payDigestUrls !== undefined ? { payDigestUrls: row.payDigestUrls } : {}),
		...(row.trialDay3EmailSentAt !== undefined
			? { trialDay3EmailSentAt: row.trialDay3EmailSentAt }
			: {}),
		...(row.trialDay3EmailMessageId !== undefined
			? { trialDay3EmailMessageId: row.trialDay3EmailMessageId }
			: {}),
		...(row.trialDay7EmailSentAt !== undefined
			? { trialDay7EmailSentAt: row.trialDay7EmailSentAt }
			: {}),
		...(row.trialDay7EmailMessageId !== undefined
			? { trialDay7EmailMessageId: row.trialDay7EmailMessageId }
			: {}),
		...(row.founderNoteSentAt !== undefined ? { founderNoteSentAt: row.founderNoteSentAt } : {}),
		...(row.plan !== undefined ? { plan: row.plan } : {}),
		...(row.nextCharge !== undefined ? { nextCharge: row.nextCharge } : {}),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
