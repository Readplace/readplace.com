import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type {
	DeleteSubscription,
	MarkSubscriptionActive,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	MarkTrialFeedbackEmailSent,
	MarkTrialReminderEmailSent,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import { SubscriptionProviderRow } from "@packages/subscription-access";

/** The write half of the subscription table — the eight mutations, wired
 * independently from the read half. The save gate composes write access from
 * the read half alone, so no save path ever depends on a mutation. */
export function initDynamoDbSubscriptionWrites(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): {
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	markTrialReminderEmailSent: MarkTrialReminderEmailSent;
	deleteSubscription: DeleteSubscription;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: SubscriptionProviderRow,
	});

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

	const markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent = async ({ userId, sentAt }) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET trialFeedbackEmailSentAt = :sentAt, updatedAt = :now",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":sentAt": sentAt,
				":now": deps.now().toISOString(),
			},
		});
	};

	const markTrialReminderEmailSent: MarkTrialReminderEmailSent = async ({ userId, sentAt }) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET trialReminderEmailSentAt = :sentAt, updatedAt = :now",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":sentAt": sentAt,
				":now": deps.now().toISOString(),
			},
		});
	};

	const deleteSubscription: DeleteSubscription = async ({ userId }) => {
		await table.delete({ Key: { userId } });
	};

	return {
		upsertTrialing,
		upsertActive,
		markPendingCancellation,
		markCancelledByUserId,
		markActive,
		markTrialFeedbackEmailSent,
		markTrialReminderEmailSent,
		deleteSubscription,
	};
}
