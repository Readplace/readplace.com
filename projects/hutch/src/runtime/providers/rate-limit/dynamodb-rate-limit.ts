import assert from "node:assert";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	writeIfCondition,
} from "@packages/storage-client";
import { z } from "zod";
import {
	fixedWindowRetryAfterSeconds,
	fixedWindowStartSeconds,
} from "@packages/domain/rate-limit";
import type {
	ClaimRateLimitUnits,
	ConsumeRateLimit,
} from "@packages/provider-contracts/rate-limit";

const RateLimitRow = z.object({ pk: z.string(), count: z.number().int() });

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
}): { consumeRateLimit: ConsumeRateLimit; claimRateLimitUnits: ClaimRateLimitUnits } {
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
		const outcome = await writeIfCondition(() =>
			table.update({
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
			}),
		);
		if (outcome.kind === "condition-failed") {
			return {
				allowed: false,
				retryAfterSeconds: fixedWindowRetryAfterSeconds({
					nowMs,
					windowSeconds: rule.windowSeconds,
				}),
			};
		}
		return { allowed: true };
	};

	const claimRateLimitUnits: ClaimRateLimitUnits = async ({ bucket, key, requested, rule }) => {
		const nowMs = deps.now().getTime();
		const windowStartSeconds = fixedWindowStartSeconds({
			nowMs,
			windowSeconds: rule.windowSeconds,
		});
		const rowKey = { pk: `${bucket}#${key}#${windowStartSeconds}` };
		let granted = 0;
		let asked = Math.min(requested, rule.limit);
		while (asked > 0) {
			const units = asked;
			const outcome = await writeIfCondition(() =>
				table.update({
					Key: rowKey,
					UpdateExpression:
						"ADD #count :units SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
					ConditionExpression: "attribute_not_exists(#count) OR #count <= :ceiling",
					ExpressionAttributeNames: { "#count": "count" },
					ExpressionAttributeValues: {
						":units": units,
						":ceiling": rule.limit - units,
						":expiresAt": windowStartSeconds + 2 * rule.windowSeconds,
					},
				}),
			);
			if (outcome.kind === "written") {
				granted = units;
				break;
			}
			const row = await table.get(rowKey, { consistentRead: true });
			assert(row, "a refused claim leaves a counter row in the window");
			asked = Math.min(units, rule.limit - row.count);
		}
		return {
			granted,
			retryAfterSeconds:
				granted < requested
					? fixedWindowRetryAfterSeconds({ nowMs, windowSeconds: rule.windowSeconds })
					: undefined,
		};
	};

	return { consumeRateLimit, claimRateLimitUnits };
}
