import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type {
	DeleteSubscription,
	MarkAutomationSavesHeldEmailSent,
	MarkSubscriptionActive,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	MarkTrialFeedbackEmailSent,
	MarkTrialReminderEmailSent,
	SetSubscriptionNextCharge,
	UpsertActiveSubscription,
	UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import { SubscriptionProviderRow } from "@packages/subscription-access";

/** The write half of the subscription table, wired independently from the read
 * half. The save gate composes write access from the read half alone, so no
 * save path ever depends on a mutation. */
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
	markAutomationSavesHeldEmailSent: MarkAutomationSavesHeldEmailSent;
	setNextCharge: SetSubscriptionNextCharge;
	deleteSubscription: DeleteSubscription;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: SubscriptionProviderRow,
	});

	/* The email markers are scoped to one trial window: their senders no-op when
	 * they are set, so a re-opened window would go out silent unless opening it
	 * clears them. */
	const upsertTrialing: UpsertTrialingSubscription = async ({ userId, trialEndsAt }) => {
		const nowIso = deps.now().toISOString();
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #provider = :provider, #status = :status, trialEndsAt = :trialEndsAt, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE subscriptionId, customerId, cancellationEffectiveAt, trialReminderEmailSentAt, trialFeedbackEmailSentAt, automationSavesHeldEmailSentAt, nextCharge",
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
				"SET #provider = :provider, #status = :status, subscriptionId = :subscriptionId, customerId = :customerId, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt, automationSavesHeldEmailSentAt, nextCharge",
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
				"SET #status = :status, cancellationEffectiveAt = :effectiveAt, updatedAt = :now REMOVE nextCharge",
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
				"SET #status = :cancelled, updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt, nextCharge",
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
			UpdateExpression: "SET #status = :status, updatedAt = :now REMOVE cancellationEffectiveAt, automationSavesHeldEmailSentAt",
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

	const markAutomationSavesHeldEmailSent: MarkAutomationSavesHeldEmailSent = async ({
		userId,
		sentAt,
	}) => {
		try {
			await table.update({
				Key: { userId },
				UpdateExpression: "SET automationSavesHeldEmailSentAt = :sentAt, updatedAt = :now",
				ConditionExpression:
					"attribute_exists(userId) AND attribute_not_exists(automationSavesHeldEmailSentAt)",
				ExpressionAttributeValues: {
					":sentAt": sentAt,
					":now": deps.now().toISOString(),
				},
			});
			return "claimed";
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return "already-sent";
			throw error;
		}
	};

	const setNextCharge: SetSubscriptionNextCharge = async ({
		userId,
		subscriptionId,
		nextCharge,
	}) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET nextCharge = :nextCharge, updatedAt = :now",
			/* An UpdateItem SET creates the row when the key is absent, so a render that
			 * outlives an account deletion would resurrect a partial row with no status
			 * and fail every later read. The charge was also read from the provider
			 * before this write, so a cancellation or a resubscribe can land in between —
			 * pinning the status and the subscription it was read from makes those a
			 * rejected write rather than a charge attached to a subscription that no
			 * longer exists. */
			ConditionExpression:
				"attribute_exists(userId) AND #status = :active AND subscriptionId = :subscriptionId",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":nextCharge": nextCharge,
				":active": "active",
				":subscriptionId": subscriptionId,
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
		markAutomationSavesHeldEmailSent,
		setNextCharge,
		deleteSubscription,
	};
}
