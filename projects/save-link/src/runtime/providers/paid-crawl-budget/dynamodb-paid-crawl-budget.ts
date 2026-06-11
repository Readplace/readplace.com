import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	fixedWindowStartSeconds,
	type RateLimitRule,
} from "@packages/domain/rate-limit";

export type ConsumePaidCrawlBudget = () => Promise<{ allowed: boolean }>;
export type RefundPaidCrawlBudget = () => Promise<void>;

const BudgetRow = z.object({ pk: z.string() });

/**
 * Global (not per-client) spend circuit-breaker for the comprehensive crawl —
 * the tier that fans out OCR and LLM cleanup, each invocation carrying real
 * third-party cost. One conditional `ADD` per crawl against the shared
 * rate-limits table; once the window's budget is consumed, the condition fails
 * for every Lambda instance until the window rolls over, bounding worst-case
 * spend even if a caller slips past the per-IP limiter.
 */
export function initDynamoDbPaidCrawlBudget(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	rule: RateLimitRule;
	now: () => Date;
}): {
	consumePaidCrawlBudget: ConsumePaidCrawlBudget;
	refundPaidCrawlBudget: RefundPaidCrawlBudget;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: BudgetRow,
	});

	const consumePaidCrawlBudget: ConsumePaidCrawlBudget = async () => {
		const nowMs = deps.now().getTime();
		const windowStartSeconds = fixedWindowStartSeconds({
			nowMs,
			windowSeconds: deps.rule.windowSeconds,
		});
		try {
			await table.update({
				Key: { pk: `paid-crawl#global#${windowStartSeconds}` },
				UpdateExpression:
					"ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
				ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
				ExpressionAttributeNames: { "#count": "count" },
				ExpressionAttributeValues: {
					":one": 1,
					":limit": deps.rule.limit,
					// TTL one extra window past the row's own window end: DynamoDB TTL
					// deletion lags by design, and an early delete would reset a live
					// counter mid-window.
					":expiresAt": windowStartSeconds + 2 * deps.rule.windowSeconds,
				},
			});
			return { allowed: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { allowed: false };
			}
			throw error;
		}
	};

	/* Hand a slot back to the current window when a crawl turns out cheap
	 * (the byte gate fired — no OCR/LLM spend). Conditioned on a positive count
	 * so a refund can never drive the counter negative: every refund pairs with
	 * a prior consume in the same window, so the guard holds in practice, and a
	 * rare miss (e.g. the window already rolled) is a swallowed no-op that fails
	 * safe toward under-spending. */
	const refundPaidCrawlBudget: RefundPaidCrawlBudget = async () => {
		const nowMs = deps.now().getTime();
		const windowStartSeconds = fixedWindowStartSeconds({
			nowMs,
			windowSeconds: deps.rule.windowSeconds,
		});
		try {
			await table.update({
				Key: { pk: `paid-crawl#global#${windowStartSeconds}` },
				UpdateExpression: "ADD #count :negOne",
				ConditionExpression: "attribute_exists(#count) AND #count > :zero",
				ExpressionAttributeNames: { "#count": "count" },
				ExpressionAttributeValues: { ":negOne": -1, ":zero": 0 },
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return;
			}
			throw error;
		}
	};

	return { consumePaidCrawlBudget, refundPaidCrawlBudget };
}
