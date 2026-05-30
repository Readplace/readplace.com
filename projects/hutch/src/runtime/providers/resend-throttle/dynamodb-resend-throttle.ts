import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { RecordResendAttempt } from "@packages/test-fixtures/providers/resend-throttle";

const COOLDOWN_SECONDS = 60;
const DAILY_CAP = 5;
const WINDOW_SECONDS = 24 * 60 * 60;

const ResendThrottleRow = z.object({
	userId: UserIdSchema,
	count: z.number(),
	nextAllowedAt: z.number(),
	expiresAt: z.number(),
});

/**
 * Per-user resend throttle backed by a single atomic conditional UpdateItem.
 * The condition lets the write through only when the row is absent (first
 * attempt in the window) or when the cooldown has elapsed AND the daily cap is
 * not yet reached; otherwise DynamoDB rejects with
 * ConditionalCheckFailedException, which surfaces as `{ ok: false }`.
 *
 * The window reset is owned by DynamoDB TTL on `expiresAt`: once the row is
 * swept, `attribute_not_exists(userId)` re-allows from scratch. TTL lag only
 * makes the cap stricter (the old count lingers), never looser.
 */
export function initDynamoDbResendThrottle(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
	cooldownSeconds?: number;
	cap?: number;
	windowSeconds?: number;
}): {
	recordResendAttempt: RecordResendAttempt;
} {
	const cooldownSeconds = deps.cooldownSeconds ?? COOLDOWN_SECONDS;
	const cap = deps.cap ?? DAILY_CAP;
	const windowSeconds = deps.windowSeconds ?? WINDOW_SECONDS;
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ResendThrottleRow,
	});

	const recordResendAttempt: RecordResendAttempt = async ({ userId }) => {
		const nowSeconds = Math.floor(deps.now().getTime() / 1000);
		try {
			await table.update({
				Key: { userId },
				ConditionExpression:
					"attribute_not_exists(userId) OR (nextAllowedAt <= :now AND #count < :cap)",
				UpdateExpression:
					"SET #count = if_not_exists(#count, :zero) + :one, nextAllowedAt = :nextAllowedAt, expiresAt = if_not_exists(expiresAt, :expiresAt)",
				ExpressionAttributeNames: { "#count": "count" },
				ExpressionAttributeValues: {
					":now": nowSeconds,
					":cap": cap,
					":zero": 0,
					":one": 1,
					":nextAllowedAt": nowSeconds + cooldownSeconds,
					":expiresAt": nowSeconds + windowSeconds,
				},
			});
			return { ok: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				return { ok: false, reason: "throttled" };
			}
			throw error;
		}
	};

	return { recordResendAttempt };
}
