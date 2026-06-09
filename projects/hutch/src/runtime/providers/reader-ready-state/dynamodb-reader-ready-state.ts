/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import type { ClaimReaderReadyEmailSlot } from "@packages/test-fixtures/providers/reader-ready-state";

const ReaderReadyNotificationRow = z.object({
	userId: UserIdSchema,
	/* Most-recent reader-ready email instant; absent until the first such email.
	 * Backs the atomic 6h per-user cooldown claim. */
	lastReaderReadyEmailAt: dynamoField(z.string()),
});

export function initDynamoDbReaderReadyState(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ReaderReadyNotificationRow,
	});

	const claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot = async ({ userId, now, cooldownMs }) => {
		const cutoff = new Date(now.getTime() - cooldownMs).toISOString();
		try {
			await table.update({
				Key: { userId },
				UpdateExpression: "SET lastReaderReadyEmailAt = :now",
				ConditionExpression:
					"attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt < :cutoff",
				ExpressionAttributeValues: {
					":now": now.toISOString(),
					":cutoff": cutoff,
				},
			});
			return true;
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return false;
			throw error;
		}
	};

	return { claimReaderReadyEmailSlot };
}
/* c8 ignore stop */
