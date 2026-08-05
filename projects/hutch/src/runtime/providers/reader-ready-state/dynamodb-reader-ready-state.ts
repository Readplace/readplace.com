import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import assert from "node:assert";
import { UserIdSchema } from "@packages/domain/user";
import type {
	ClaimReaderReadyEmailSlot,
	DeleteReaderReadyState,
	ReleaseReaderReadyEmailSlot,
} from "@packages/provider-contracts/reader-ready-state";

const ReaderReadyNotificationRow = z.object({
	userId: UserIdSchema,
	/* Most-recent reader-ready email instant; absent until the first such email.
	 * Backs the atomic 6h per-user cooldown claim. */
	lastReaderReadyEmailAt: dynamoField(z.string()),
	/* SQS message that owns the current claim. Absent on rows written before the
	 * claim became message-scoped, which read as "not my claim" and so need no
	 * migration. */
	lastReaderReadyEmailMessageId: dynamoField(z.string()),
});

export function initDynamoDbReaderReadyState(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot;
	releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot;
	deleteReaderReadyState: DeleteReaderReadyState;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: ReaderReadyNotificationRow,
	});

	const claimReaderReadyEmailSlot: ClaimReaderReadyEmailSlot = async ({
		userId,
		now,
		cooldownMs,
		messageId,
	}) => {
		const cutoff = new Date(now.getTime() - cooldownMs).toISOString();
		try {
			/* The claim and the effect it guards are the same item, so one conditional
			 * UpdateItem is atomic on its own — no transaction needed. */
			await table.update({
				Key: { userId },
				UpdateExpression:
					"SET lastReaderReadyEmailAt = :now, lastReaderReadyEmailMessageId = :messageId",
				ConditionExpression:
					"attribute_not_exists(lastReaderReadyEmailAt) OR lastReaderReadyEmailAt < :cutoff",
				ExpressionAttributeValues: {
					":now": now.toISOString(),
					":cutoff": cutoff,
					":messageId": messageId,
				},
			});
			return { claimed: true, redelivery: false };
		} catch (error) {
			if (!(error instanceof ConditionalCheckFailedException)) throw error;
		}

		/* The slot is held and still inside its cooldown. Reading it decides whose:
		 * this message's own earlier receive, or another message's live claim. The
		 * rejected write left the row untouched, which is what keeps the stored
		 * instant pinned to the send it anchors — a claim that moved forward on each
		 * receive would eventually read rows enqueued after the email as having been
		 * in it, and drain them unsent. Strongly consistent because this read must
		 * observe the very write that rejected the conditional: a replica still on
		 * the pre-claim state would misread a redelivery as a foreign claim, ack the
		 * message, and leave the rows to re-send as a duplicate on the next tick. */
		const held = await table.get({ userId }, { consistentRead: true });
		if (held?.lastReaderReadyEmailMessageId !== messageId) return { claimed: false };
		assert(
			held.lastReaderReadyEmailAt,
			"a stored claim carries its instant alongside its messageId",
		);
		return { claimed: true, redelivery: true, claimedAt: new Date(held.lastReaderReadyEmailAt) };
	};

	const releaseReaderReadyEmailSlot: ReleaseReaderReadyEmailSlot = async ({
		userId,
		claimedAt,
		messageId,
	}) => {
		try {
			await table.update({
				Key: { userId },
				UpdateExpression: "REMOVE lastReaderReadyEmailAt, lastReaderReadyEmailMessageId",
				ConditionExpression:
					"lastReaderReadyEmailAt = :claimedAt AND lastReaderReadyEmailMessageId = :messageId",
				ExpressionAttributeValues: {
					":claimedAt": claimedAt.toISOString(),
					":messageId": messageId,
				},
			});
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return;
			throw error;
		}
	};

	const deleteReaderReadyState: DeleteReaderReadyState = async (userId) => {
		await table.delete({ Key: { userId } });
	};

	return { claimReaderReadyEmailSlot, releaseReaderReadyEmailSlot, deleteReaderReadyState };
}
