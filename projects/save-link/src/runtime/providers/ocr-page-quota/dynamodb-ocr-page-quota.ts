import {
	type DynamoDBDocumentClient,
	TransactWriteCommand,
	TransactionCanceledException,
	defineDynamoTable,
} from "@packages/storage-client";
import { z } from "zod";
import type { RateLimitRule } from "@packages/domain/rate-limit";
import { addPagesToSlots, pagesLeftInWindow, retryAtFor } from "@packages/domain/ocr-page-allowance";
import type { UserId } from "@packages/domain/user";
import type { ChargeOcrPages, OcrPageCharge } from "@packages/crawl-article";

const CounterRow = z.object({
	pk: z.string(),
	version: z.number(),
	slots: z.array(z.object({ slotStart: z.number(), pages: z.number() })),
});

const ClaimRow = z.object({ pk: z.string() });

const MAX_CHARGE_ATTEMPTS = 6;
const CONFLICT_RETRY_BASE_DELAY_MS = 50;
const ROW_LIFETIME_SECONDS = 25 * 3600;

export type ChargeOcrPagesFor = (params: { userId: UserId; claimId: string }) => ChargeOcrPages;

export function initDynamoDbOcrPageQuota(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	rule: RateLimitRule;
	now: () => Date;
	delay: (milliseconds: number) => Promise<void>;
}): { chargeOcrPagesFor: ChargeOcrPagesFor } {
	const counters = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: CounterRow });
	const claims = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ClaimRow });

	const chargeOcrPagesFor: ChargeOcrPagesFor = ({ userId, claimId }) => async ({ pages }) => {
		const counterKey = { pk: `ocr-pages#${userId}` };
		const claimKey = { pk: `ocr-pages-claim#${userId}#${claimId}` };
		if (await claims.get(claimKey, { consistentRead: true })) return { allowed: true };

		const attempt = async (attemptNumber: number): Promise<OcrPageCharge> => {
			const nowMs = deps.now().getTime();
			const counter = await counters.get(counterKey, { consistentRead: true });
			const slots = counter?.slots ?? [];
			const pagesLeft = pagesLeftInWindow({ slots, nowMs, limit: deps.rule.limit });
			if (pagesLeft < pages) {
				return { allowed: false, pagesLeft, retryAt: retryAtFor({ slots, nowMs, limit: deps.rule.limit, pages }) };
			}
			const expiresAt = Math.floor(nowMs / 1000) + ROW_LIFETIME_SECONDS;
			const version = counter?.version ?? 0;
			try {
				await deps.client.send(
					new TransactWriteCommand({
						TransactItems: [
							{
								Put: {
									TableName: deps.tableName,
									Item: { ...claimKey, expiresAt },
									ConditionExpression: "attribute_not_exists(pk)",
								},
							},
							{
								Put: {
									TableName: deps.tableName,
									Item: {
										...counterKey,
										slots: addPagesToSlots({ slots, nowMs, pages }),
										version: version + 1,
										expiresAt,
									},
									ConditionExpression: counter ? "version = :version" : "attribute_not_exists(pk)",
									...(counter ? { ExpressionAttributeValues: { ":version": version } } : {}),
								},
							},
						],
					}),
				);
				return { allowed: true };
			} catch (error) {
				if (!(error instanceof TransactionCanceledException)) throw error;
				const reasons = error.CancellationReasons ?? [];
				if (reasons[0]?.Code === "ConditionalCheckFailed") return { allowed: true };
				const raced = reasons[1]?.Code === "ConditionalCheckFailed" || reasons.some((reason) => reason.Code === "TransactionConflict");
				if (!raced || attemptNumber >= MAX_CHARGE_ATTEMPTS) throw error;
				await deps.delay(Math.random() * CONFLICT_RETRY_BASE_DELAY_MS * 2 ** (attemptNumber - 1));
				return attempt(attemptNumber + 1);
			}
		};
		return attempt(1);
	};

	return { chargeOcrPagesFor };
}
