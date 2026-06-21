import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	fixedWindowRetryAfterSeconds,
	fixedWindowStartSeconds,
} from "@packages/domain/rate-limit";
import type { ConsumeRateLimit } from "@packages/provider-contracts/rate-limit";

const RateLimitRow = z.object({ pk: z.string() });

/**
 * Distributed fixed-window counter. One conditional `ADD` per request against
 * a row keyed by `(bucket, key, windowStart)`; the condition fails once the
 * counter reaches the limit, so exactly `rule.limit` requests succeed per
 * window regardless of how many Lambda instances serve them concurrently.
 */
export function initDynamoDbRateLimit(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
	now: () => Date;
}): { consumeRateLimit: ConsumeRateLimit } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: RateLimitRow,
	});

	const consumeRateLimit: ConsumeRateLimit = async ({ bucket, key, rule }) => {
		const nowMs = deps.now().getTime();
		const windowStartSeconds = fixedWindowStartSeconds({
			nowMs,
			windowSeconds: rule.windowSeconds,
		});
		try {
			await table.update({
				Key: { pk: `${bucket}#${key}#${windowStartSeconds}` },
				UpdateExpression:
					"ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
				ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
				ExpressionAttributeNames: { "#count": "count" },
				ExpressionAttributeValues: {
					":one": 1,
					":limit": rule.limit,
					// TTL one extra window past the row's own window end: DynamoDB TTL
					// deletion lags by design, and an early delete would reset a live
					// counter mid-window.
					":expiresAt": windowStartSeconds + 2 * rule.windowSeconds,
				},
			});
			return { allowed: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return {
					allowed: false,
					retryAfterSeconds: fixedWindowRetryAfterSeconds({
						nowMs,
						windowSeconds: rule.windowSeconds,
					}),
				};
			}
			throw error;
		}
	};

	return { consumeRateLimit };
}
