import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type {
	ClearChargeFailed,
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	FindSubscriptionByUserIdConsistent,
	MarkChargeFailed,
	MarkChargeRequested,
	MarkSubscriptionActive,
	MarkSubscriptionCancelled,
	MarkSubscriptionCancelledByUserId,
	MarkSubscriptionPendingCancellation,
	SubscriptionRecord,
	UpsertActiveSubscription,
	UpsertCancelledSubscription,
	UpsertCustomerId,
	UpsertPaymentMethod,
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
	paymentMethodId: dynamoField(z.string()),
	paymentMethodBrand: dynamoField(z.string()),
	paymentMethodLast4: dynamoField(z.string()),
	chargeRequestedAt: dynamoField(z.string()),
	chargeFailedAt: dynamoField(z.string()),
	chargeFailedReason: dynamoField(z.string()),
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
		...(row.paymentMethodId !== undefined ? { paymentMethodId: row.paymentMethodId } : {}),
		...(row.paymentMethodBrand !== undefined ? { paymentMethodBrand: row.paymentMethodBrand } : {}),
		...(row.paymentMethodLast4 !== undefined ? { paymentMethodLast4: row.paymentMethodLast4 } : {}),
		...(row.chargeRequestedAt !== undefined ? { chargeRequestedAt: row.chargeRequestedAt } : {}),
		...(row.chargeFailedAt !== undefined ? { chargeFailedAt: row.chargeFailedAt } : {}),
		...(row.chargeFailedReason !== undefined ? { chargeFailedReason: row.chargeFailedReason } : {}),
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
	findByUserIdConsistent: FindSubscriptionByUserIdConsistent;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
	upsertTrialing: UpsertTrialingSubscription;
	upsertActive: UpsertActiveSubscription;
	upsertCancelled: UpsertCancelledSubscription;
	upsertCustomerId: UpsertCustomerId;
	upsertPaymentMethod: UpsertPaymentMethod;
	markChargeRequested: MarkChargeRequested;
	markChargeFailed: MarkChargeFailed;
	clearChargeFailed: ClearChargeFailed;
	markPendingCancellation: MarkSubscriptionPendingCancellation;
	markCancelled: MarkSubscriptionCancelled;
	markCancelledByUserId: MarkSubscriptionCancelledByUserId;
	markActive: MarkSubscriptionActive;
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

	const findByUserIdConsistent: FindSubscriptionByUserIdConsistent = async (userId) => {
		const row = await table.get({ userId }, { consistentRead: true });
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
				"SET #provider = :provider, #status = :status, trialEndsAt = :trialEndsAt, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE subscriptionId, customerId, cancellationEffectiveAt, paymentMethodId, paymentMethodBrand, paymentMethodLast4, chargeRequestedAt, chargeFailedAt, chargeFailedReason",
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
				"SET #provider = :provider, #status = :status, subscriptionId = :subscriptionId, customerId = :customerId, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt, chargeRequestedAt, chargeFailedAt, chargeFailedReason",
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

	const upsertCancelled: UpsertCancelledSubscription = async ({ userId }) => {
		const nowIso = deps.now().toISOString();
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET #provider = :provider, #status = :status, createdAt = if_not_exists(createdAt, :now), updatedAt = :now REMOVE trialEndsAt, cancellationEffectiveAt, subscriptionId, chargeRequestedAt",
			ExpressionAttributeNames: {
				"#provider": "provider",
				"#status": "status",
			},
			ExpressionAttributeValues: {
				":provider": "stripe",
				":status": "cancelled",
				":now": nowIso,
			},
		});
	};

	const upsertCustomerId: UpsertCustomerId = async ({ userId, customerId }) => {
		const nowIso = deps.now().toISOString();
		try {
			await table.update({
				Key: { userId },
				UpdateExpression:
					"SET #provider = :provider, customerId = :customerId, #status = if_not_exists(#status, :cancelled), createdAt = if_not_exists(createdAt, :now), updatedAt = :now",
				ConditionExpression: "attribute_not_exists(customerId)",
				ExpressionAttributeNames: {
					"#provider": "provider",
					"#status": "status",
				},
				ExpressionAttributeValues: {
					":provider": "stripe",
					":customerId": customerId,
					":cancelled": "cancelled",
					":now": nowIso,
				},
			});
			return { ok: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "customer-id-already-set" };
			}
			throw error;
		}
	};

	const upsertPaymentMethod: UpsertPaymentMethod = async ({ userId, paymentMethodId, brand, last4 }) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET paymentMethodId = :pm, paymentMethodBrand = :brand, paymentMethodLast4 = :last4, updatedAt = :now REMOVE chargeFailedAt, chargeFailedReason",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":pm": paymentMethodId,
				":brand": brand,
				":last4": last4,
				":now": deps.now().toISOString(),
			},
		});
	};

	const markChargeRequested: MarkChargeRequested = async ({ userId, requestedAt }) => {
		try {
			await table.update({
				Key: { userId },
				UpdateExpression: "SET chargeRequestedAt = :req, updatedAt = :now",
				ConditionExpression: "attribute_exists(userId) AND attribute_not_exists(chargeRequestedAt)",
				ExpressionAttributeValues: {
					":req": requestedAt,
					":now": deps.now().toISOString(),
				},
			});
			return { ok: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "charge-already-requested" };
			}
			throw error;
		}
	};

	const markChargeFailed: MarkChargeFailed = async ({ userId, failedAt, reason }) => {
		await table.update({
			Key: { userId },
			UpdateExpression:
				"SET chargeFailedAt = :at, chargeFailedReason = :reason, updatedAt = :now REMOVE chargeRequestedAt",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":at": failedAt,
				":reason": reason,
				":now": deps.now().toISOString(),
			},
		});
	};

	const clearChargeFailed: ClearChargeFailed = async ({ userId }) => {
		await table.update({
			Key: { userId },
			UpdateExpression: "SET updatedAt = :now REMOVE chargeFailedAt, chargeFailedReason",
			ConditionExpression: "attribute_exists(userId)",
			ExpressionAttributeValues: {
				":now": deps.now().toISOString(),
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

	return {
		findByUserId,
		findByUserIdConsistent,
		findBySubscriptionId,
		upsertTrialing,
		upsertActive,
		upsertCancelled,
		upsertCustomerId,
		upsertPaymentMethod,
		markChargeRequested,
		markChargeFailed,
		clearChargeFailed,
		markPendingCancellation,
		markCancelled,
		markCancelledByUserId,
		markActive,
	};
}
