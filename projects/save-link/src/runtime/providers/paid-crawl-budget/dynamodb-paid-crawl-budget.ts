import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import {
	fixedWindowStartSeconds,
	type RateLimitRule,
} from "@packages/domain/rate-limit";

/** `consumed` distinguishes a fresh spend (this call incremented the counter)
 * from an idempotent re-consume of a message already counted this window (a
 * redelivery): only a fresh spend may later be refunded. */
export type ConsumePaidCrawlBudget = (input: {
	messageId: string;
}) => Promise<{ allowed: false } | { allowed: true; consumed: boolean }>;
export type RefundPaidCrawlBudget = () => Promise<void>;

const BudgetRow = z.object({ pk: z.string() });

/**
 * Global (not per-client) spend circuit-breaker for the comprehensive crawl —
 * the tier that fans out OCR and LLM cleanup, each invocation carrying real
 * third-party cost. Each consume is a two-item transaction against the shared
 * rate-limits table: a per-message claim marker (so a redelivery of an
 * already-counted message is a no-op rather than a second spend) committed
 * atomically with a conditional `ADD` on the global window counter. Once the
 * window's budget is consumed the counter condition fails for every Lambda
 * instance until the window rolls over, bounding worst-case spend even if a
 * caller slips past the per-IP limiter.
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

	const consumePaidCrawlBudget: ConsumePaidCrawlBudget = async ({ messageId }) => {
		const nowMs = deps.now().getTime();
		const windowStartSeconds = fixedWindowStartSeconds({
			nowMs,
			windowSeconds: deps.rule.windowSeconds,
		});
		// TTL one extra window past the row's own window end: DynamoDB TTL
		// deletion lags by design, and an early delete would reset a live counter
		// mid-window. The claim marker shares the counter's window so a message
		// redelivered after the window rolls re-competes against the new budget.
		const expiresAt = windowStartSeconds + 2 * deps.rule.windowSeconds;
		try {
			await deps.client.send(
				new TransactWriteCommand({
					TransactItems: [
						{
							// Per-message idempotency claim. The create-if-absent condition
							// fails when this message already consumed a slot this window, so
							// re-running the gate on a redelivery adds nothing to the counter.
							Update: {
								TableName: deps.tableName,
								Key: { pk: `paid-crawl#claim#${messageId}#${windowStartSeconds}` },
								UpdateExpression: "SET expiresAt = :expiresAt",
								ConditionExpression: "attribute_not_exists(pk)",
								ExpressionAttributeValues: { ":expiresAt": expiresAt },
							},
						},
						{
							// Global window counter — the conditional ADD fails once the
							// budget is spent, atomically with the claim above so a denied
							// crawl never leaves a stranded claim marker behind.
							Update: {
								TableName: deps.tableName,
								Key: { pk: `paid-crawl#global#${windowStartSeconds}` },
								UpdateExpression:
									"ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)",
								ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
								ExpressionAttributeNames: { "#count": "count" },
								ExpressionAttributeValues: {
									":one": 1,
									":limit": deps.rule.limit,
									":expiresAt": expiresAt,
								},
							},
						},
					],
				}),
			);
			return { allowed: true, consumed: true };
		} catch (error) {
			if (error instanceof TransactionCanceledException) {
				// CancellationReasons are positional: [0] = claim marker, [1] = counter.
				const reasons = error.CancellationReasons;
				const claimRejected = reasons?.[0]?.Code === "ConditionalCheckFailed";
				const counterRejected = reasons?.[1]?.Code === "ConditionalCheckFailed";
				// Claim rejected → this message already paid a slot this window (a
				// redelivery): allow without re-incrementing. Else counter rejected →
				// the window's budget is spent. Any other cancellation (throttling,
				// capacity) is not a budget decision, so it rethrows and the SQS gate
				// re-runs on the next receive (fail closed) rather than slipping past.
				if (claimRejected) return { allowed: true, consumed: false };
				if (counterRejected) return { allowed: false };
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
