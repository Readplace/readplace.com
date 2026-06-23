import type { DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { initDynamoDbSubscriptionRead } from "./dynamodb-subscription-read";
import { initDynamoDbSubscriptionWrites } from "./dynamodb-subscription-writes";

/** The full subscription table (read + write), for entry points that need both
 * — the Lambda handlers and CLIs that consume the whole provider surface. The
 * web composition root assembles the two halves directly so it can later swap
 * the write half for an HTTP adapter without touching the read half. */
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
