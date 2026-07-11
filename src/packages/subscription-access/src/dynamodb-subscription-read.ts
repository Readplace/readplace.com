import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type {
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
} from "@packages/provider-contracts/subscription-providers";
import { SubscriptionProviderRow, toRecord } from "./subscription-provider-row";

/** The read half of the subscription table. Every deployable that gates on
 * access (hutch's save gate, the inbox app's write gate) composes the decision
 * locally from this lookup — a gate must never depend on the subscription
 * service over HTTP. */
export function initDynamoDbSubscriptionRead(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findByUserId: FindSubscriptionByUserId;
	findBySubscriptionId: FindSubscriptionBySubscriptionId;
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

	return { findByUserId, findBySubscriptionId };
}
