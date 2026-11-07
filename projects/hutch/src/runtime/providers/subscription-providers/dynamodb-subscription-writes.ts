import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	writeIfCondition,
} from "@packages/storage-client";
import {
	type ClaimPayDigest,
	type ClaimTrialNudge,
	type ReleaseTrialNudge,
	type DeleteSubscription,
	type MarkAutomationSavesHeldEmailSent,
	type MarkSubscriptionActive,
	type MarkSubscriptionCancelledByEvent,
	type MarkSubscriptionPendingCancellationByEvent,
	type MarkTrialFeedbackEmailSent,
	type MarkTrialReminderEmailSent,
	type RecordFounderNote,
	type ReleasePayDigest,
	type SetSubscriptionNextCharge,
	TRIAL_NUDGE_MARKERS,
	type UpsertActiveSubscription,
	type UpsertTrialingSubscription,
} from "@packages/provider-contracts/subscription-providers";
import { toEventInstant } from "@packages/domain/event-envelope";
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
	markPendingCancellationByEvent: MarkSubscriptionPendingCancellationByEvent;
	markCancelledByEvent: MarkSubscriptionCancelledByEvent;
	markActive: MarkSubscriptionActive;
	markTrialFeedbackEmailSent: MarkTrialFeedbackEmailSent;
	markTrialReminderEmailSent: MarkTrialReminderEmailSent;
	markAutomationSavesHeldEmailSent: MarkAutomationSavesHeldEmailSent;
	claimPayDigest: ClaimPayDigest;
	releasePayDigest: ReleasePayDigest;
	claimTrialNudge: ClaimTrialNudge;
	releaseTrialNudge: ReleaseTrialNudge;
	recordFounderNote: RecordFounderNote;
	setNextCharge: SetSubscriptionNextCharge;
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
				"SET #provider = :provider, #status = :status, trialEndsAt = :trialEndsAt, statusEnteredAt = :statusEnteredAt, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE subscriptionId, customerId, cancellationEffectiveAt, trialReminderEmailSentAt, trialFeedbackEmailSentAt, automationSavesHeldEmailSentAt, payDigestEmailSentAt, payDigestMessageId, payDigestUrls, nextCharge, #plan",
			ExpressionAttributeNames: {
				"#provider": "provider",
				"#status": "status",
				"#plan": "plan",
			},
			ExpressionAttributeValues: {
				":provider": "stripe",
				":status": "trialing",
				":trialEndsAt": trialEndsAt,
				":statusEnteredAt": toEventInstant(deps.now()),
				":now": nowIso,
			},
		});
	};

	const upsertActive: UpsertActiveSubscription = async ({
		userId,
		subscriptionId,
		customerId,
		plan,
	}) => {
		const nowIso = deps.now().toISOString();
		const planSet = plan === undefined ? "" : ", #plan = :plan";
		const planRemove = plan === undefined ? ", #plan" : "";
		await table.update({
			Key: { userId },
			UpdateExpression: `SET #provider = :provider, #status = :status, subscriptionId = :subscriptionId, customerId = :customerId${planSet}, statusEnteredAt = :statusEnteredAt, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt, automationSavesHeldEmailSentAt, nextCharge${planRemove}`,
			ExpressionAttributeNames: {
				"#provider": "provider",
				"#status": "status",
				"#plan": "plan",
			},
			ExpressionAttributeValues: {
				":provider": "stripe",
				":status": "active",
				":subscriptionId": subscriptionId,
				":customerId": customerId,
				...(plan === undefined ? {} : { ":plan": plan }),
				":statusEnteredAt": toEventInstant(deps.now()),
				":now": nowIso,
			},
		});
	};

	const STATUS_NOT_NEWER_THAN_EVENT =
		"attribute_exists(userId) AND (attribute_not_exists(statusEnteredAt) OR statusEnteredAt <= :eventTime)";

	const markPendingCancellationByEvent: MarkSubscriptionPendingCancellationByEvent = async ({
		userId,
		cancellationEffectiveAt,
		eventTime,
	}) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #status = :status, cancellationEffectiveAt = :effectiveAt, statusEnteredAt = :statusEnteredAt, updatedAt = :now REMOVE nextCharge",
			ConditionExpression: STATUS_NOT_NEWER_THAN_EVENT,
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":status": "pending_cancellation",
				":effectiveAt": cancellationEffectiveAt,
				":eventTime": eventTime,
				":statusEnteredAt": toEventInstant(deps.now()),
				":now": deps.now().toISOString(),
			},
		});
	};

	const markCancelledByEvent: MarkSubscriptionCancelledByEvent = async ({ userId, eventTime }) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #status = :cancelled, statusEnteredAt = :statusEnteredAt, updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt, nextCharge",
			ConditionExpression: STATUS_NOT_NEWER_THAN_EVENT,
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":cancelled": "cancelled",
				":eventTime": eventTime,
				":statusEnteredAt": toEventInstant(deps.now()),
				":now": deps.now().toISOString(),
			},
		});
	};

	const markActive: MarkSubscriptionActive = async ({ userId }) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #status = :status, statusEnteredAt = :statusEnteredAt, updatedAt = :now REMOVE cancellationEffectiveAt, automationSavesHeldEmailSentAt",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeNames: { "#status": "status" },
			ExpressionAttributeValues: {
				":status": "active",
				":statusEnteredAt": toEventInstant(deps.now()),
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
		const outcome = await writeIfCondition(() =>
			table.update({
				Key: { userId },
				UpdateExpression: "SET automationSavesHeldEmailSentAt = :sentAt, updatedAt = :now",
				ConditionExpression:
					"attribute_exists(userId) AND attribute_not_exists(automationSavesHeldEmailSentAt)",
				ExpressionAttributeValues: {
					":sentAt": sentAt,
					":now": deps.now().toISOString(),
				},
			}),
		);
		return outcome.kind === "written" ? "claimed" : "already-sent";
	};

	const claimPayDigest: ClaimPayDigest = async ({ userId, trialEndsAt, messageId, now, urls }) => {
		const outcome = await writeIfCondition(() =>
			table.update({
				Key: { userId },
				UpdateExpression:
					"SET payDigestEmailSentAt = :now, payDigestMessageId = :mid, payDigestUrls = :urls, updatedAt = :now",
				ConditionExpression:
					"attribute_exists(userId) AND #status = :trialing AND trialEndsAt = :trialEndsAt AND attribute_not_exists(payDigestEmailSentAt)",
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":now": now.toISOString(),
					":mid": messageId,
					":urls": urls,
					":trialing": "trialing",
					":trialEndsAt": trialEndsAt,
				},
			}),
		);
		if (outcome.kind === "written") return { claimed: true, redelivery: false };

		const held = await table.get({ userId }, { consistentRead: true });
		if (held?.payDigestMessageId !== messageId) return { claimed: false };
		assert(held.payDigestEmailSentAt, "a stored pay-digest claim carries its instant");
		assert(held.payDigestUrls, "a stored pay-digest claim carries the urls it listed");
		return {
			claimed: true,
			redelivery: true,
			claimedAt: new Date(held.payDigestEmailSentAt),
			urls: held.payDigestUrls,
		};
	};

	const releasePayDigest: ReleasePayDigest = async ({ userId, claimedAt, messageId }) => {
		await writeIfCondition(() =>
			table.update({
				Key: { userId },
				UpdateExpression: "REMOVE payDigestEmailSentAt, payDigestMessageId, payDigestUrls",
				ConditionExpression: "payDigestEmailSentAt = :claimedAt AND payDigestMessageId = :mid",
				ExpressionAttributeValues: {
					":claimedAt": claimedAt.toISOString(),
					":mid": messageId,
				},
			}),
		);
	};

	const claimTrialNudge: ClaimTrialNudge = async ({ userId, kind, messageId, now }) => {
		const marker = TRIAL_NUDGE_MARKERS[kind];
		const outcome = await writeIfCondition(() =>
			table.update({
				Key: { userId },
				UpdateExpression: `SET ${marker.sentAt} = :now, ${marker.messageId} = :mid, updatedAt = :now`,
				ConditionExpression: `attribute_exists(userId) AND #status = :trialing AND attribute_not_exists(${marker.sentAt})`,
				ExpressionAttributeNames: { "#status": "status" },
				ExpressionAttributeValues: {
					":now": now.toISOString(),
					":mid": messageId,
					":trialing": "trialing",
				},
			}),
		);
		if (outcome.kind === "written") return { claimed: true };

		const held = await table.get({ userId }, { consistentRead: true });
		if (held?.[marker.messageId] !== messageId) return { claimed: false };
		return { claimed: true };
	};

	const releaseTrialNudge: ReleaseTrialNudge = async ({ userId, kind, messageId }) => {
		const marker = TRIAL_NUDGE_MARKERS[kind];
		await writeIfCondition(() =>
			table.update({
				Key: { userId },
				UpdateExpression: `REMOVE ${marker.sentAt}, ${marker.messageId}`,
				ConditionExpression: `${marker.messageId} = :mid`,
				ExpressionAttributeValues: { ":mid": messageId },
			}),
		);
	};

	const recordFounderNote: RecordFounderNote = async ({ userId, sentAt }) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET founderNoteSentAt = :sentAt, updatedAt = :now",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":sentAt": sentAt,
				":now": deps.now().toISOString(),
			},
		});
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
		markPendingCancellationByEvent,
		markCancelledByEvent,
		markActive,
		markTrialFeedbackEmailSent,
		markTrialReminderEmailSent,
		markAutomationSavesHeldEmailSent,
		claimPayDigest,
		releasePayDigest,
		claimTrialNudge,
		releaseTrialNudge,
		recordFounderNote,
		setNextCharge,
		deleteSubscription,
	};
}
