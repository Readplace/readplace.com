import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	MarkSubscriptionActive,
	MarkSubscriptionCancelled,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	MarkTrialFeedbackEmailSent,
	SubscriptionRecord,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/test-fixtures/providers/subscription-providers";

const SubscriptionProviderRow = z.object({
	userId: UserIdSchema,
	provider: z.literal("stripe"),
	subscriptionId: dynamoField(z.string()),
	customerId: dynamoField(z.string()),
	status: z.enum(["trialing", "active", "pending_cancellation", "cancelled"]),
	trialEndsAt: dynamoField(z.string()),
	cancellationEffectiveAt: dynamoField(z.string()),
	trialFeedbackEmailSentAt: dynamoField(z.string()),
	createdAt: z.string(),
	updatedAt: z.string(),
});

function toRecord(row: z.infer<typeof SubscriptionProviderRow>): SubscriptionRecord {
	return {
		userId: row.userId,
		provider: row.provider,
		...(row.subscriptionId !== undefined ? { subscriptionId: row.subscriptionId } : {}),
		...(row.customerId !== undefined ? { customerId: row.customerId } : {}),
		status: row.status,
		...(row.trialEndsAt !== undefined ? { trialEndsAt: row.trialEndsAt } : {}),
		...(row.cancellationEffectiveAt !== undefined ? { cancellationEffectiveAt: row.cancellationEffectiveAt } : {}),
		...(row.trialFeedbackEmailSentAt !== undefined
			? { trialFeedbackEmailSentAt: row.trialFeedbackEmailSentAt }
			: {}),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export function initDynamoDbSubscriptionProviders(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	findByUserId: FindSubscriptionByUserId;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelled: MarkSubscriptionCancelled;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: SubscriptionProviderRow,
	});

	const findByUserId: FindSubscriptionByUserId = async (userId) => {
		const row = await table.get({ userId });
		return row ? toRecord(row) : undefined;
	};

	const findBySubscriptionId: FindSubscriptionBySubscriptionId = async (subscriptionId) => {
		const { items } = await table.query({
			IndexName: "subscriptionId-index",
			KeyConditionExpression: "subscriptionId = :sid",
			ExpressionAttributeValues: { ":sid": subscriptionId },
			Limit: 1,
		});
		const row = items[0];
		return row ? toRecord(row) : undefined;
	};

	const upsertTrialing: UpsertTrialingSubscription = async ({ userId, trialEndsAt }) => {
		const nowIso = deps.now().toISOString();
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #provider = :provider, #status = :status, trialEndsAt = :trialEndsAt, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE subscriptionId, customerId, cancellationEffectiveAt",
			ExpressionAttributeNames: {
				"#provider": "provider",
				"#status": "status",
			},
			ExpressionAttributeValues: {
				":provider": "stripe",
				":status": "trialing",
				":trialEndsAt": trialEndsAt,
				":now": nowIso,
			},
		});
	};

	const upsertActive: UpsertActiveSubscription = async ({ userId, subscriptionId, customerId }) => {
		const nowIso = deps.now().toISOString();
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #provider = :provider, #status = :status, subscriptionId = :subscriptionId, customerId = :customerId, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt",
			ExpressionAttributeNames: {
				"#provider": "provider",
				"#status": "status",
			},
			ExpressionAttributeValues: {
				":provider": "stripe",
				":status": "active",
				":subscriptionId": subscriptionId,
				":customerId": customerId,
				":now": nowIso,
			},
		});
	};

	const markPendingCancellation: MarkSubscriptionPendingCancellation = async ({ userId, cancellationEffectiveAt }) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #status = :status, cancellationEffectiveAt = :effectiveAt, updatedAt = :now",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":status": "pending_cancellation",
				":effectiveAt": cancellationEffectiveAt,
				":now": deps.now().toISOString(),
			},
		});
	};

	const markCancelled: MarkSubscriptionCancelled = async ({ subscriptionId }) => {
		const { items } = await table.query({
			IndexName: "subscriptionId-index",
			KeyConditionExpression: "subscriptionId = :sid",
			ExpressionAttributeValues: { ":sid": subscriptionId },
			Limit: 1,
		});
		const row = items[0];
		if (!row) throw new Error(`No subscription row for subscriptionId ${subscriptionId}`);
		await table.update({
			Key: { userId: row.userId },
			UpdateExpression: "SET #status = :status, updatedAt = :now",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":status": "cancelled",
				":now": deps.now().toISOString(),
			},
		});
	};

	const markCancelledByUserId: MarkSubscriptionCancelledByUserId = async ({ userId }) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #status = :cancelled, updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":cancelled": "cancelled",
				":now": deps.now().toISOString(),
			},
		});
	};

	const markActive: MarkSubscriptionActive = async ({ userId }) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET #status = :status, updatedAt = :now REMOVE cancellationEffectiveAt",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":status": "active",
				":now": deps.now().toISOString(),
			},
		});
	};

	const markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent = async ({
		userId,
		sentAt,
	}) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET trialFeedbackEmailSentAt = :sentAt, updatedAt = :now",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":sentAt": sentAt,
				":now": deps.now().toISOString(),
			},
		});
	};

	return {
		findByUserId,
		findBySubscriptionId,
		upsertTrialing,
		upsertActive,
		markPendingCancellation,
		markCancelled,
		markCancelledByUserId,
		markActive,
		markTrialFeedbackEmailSent,
	};
}
