import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbSubscriptionRead } from "@packages/subscription-access";
import { initDynamoDbSubscriptionWrites } from "./dynamodb-subscription-writes";

/** The full subscription table (read + write), for entry points that need both
 * — the Lambda handlers and CLIs that consume the whole provider surface. The
 * web composition root assembles the two halves directly, keeping the read half
 * (which the save gate depends on) independent of the write half. */
export function initDynamoDbSubscriptionProviders(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}) {
	return {
		...initDynamoDbSubscriptionRead({ client: deps.client, tableName: deps.tableName }),
		...initDynamoDbSubscriptionWrites(deps),
	};
}
