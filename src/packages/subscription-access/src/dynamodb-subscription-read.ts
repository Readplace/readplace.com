import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import type {
	FindSubscriptionBySubscriptionId,
	FindSubscriptionByUserId,
	ListAllSubscriptionRows,
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
	listAllSubscriptionRows: ListAllSubscriptionRows;
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

	const listAllSubscriptionRows: ListAllSubscriptionRows = async () => {
		const records = [];
		let lastEvaluatedKey: Record<string, unknown> | undefined;
		do {
			const page = await table.scan({ ExclusiveStartKey: lastEvaluatedKey });
			for (const row of page.items) records.push(toRecord(row));
			lastEvaluatedKey = page.lastEvaluatedKey;
		} while (lastEvaluatedKey !== undefined);
		return records;
	};

	return { findByUserId, findBySubscriptionId, listAllSubscriptionRows };
}
