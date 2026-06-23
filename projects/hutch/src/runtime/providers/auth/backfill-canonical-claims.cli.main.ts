/* c8 ignore start -- one-off backfill script, run manually against staging then prod */
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import {
	ConditionalCheckFailedException,
	createDynamoDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { gmailIdentityKey } from "@packages/domain/user";
import { requireEnv } from "../../domain/require-env";
import { gmailClaimPk } from "./canonical-claim";

const logger = HutchLogger.from(consoleLogger);

const Row = z.object({
	email: z.string(),
	userId: dynamoField(z.string()),
	ownerUserId: dynamoField(z.string()),
});

async function main(): Promise<void> {
	const tableName = requireEnv("DYNAMODB_USERS_TABLE");
	const client = createDynamoDocumentClient();
	const users = defineDynamoTable({ client, tableName, schema: Row });

	let scanned = 0;
	let claimed = 0;
	let alreadyOwned = 0;
	let collisions = 0;
	let startKey: Record<string, unknown> | undefined;
	do {
		const page = await users.scan({
			ProjectionExpression: "email, userId",
			// Claim items carry ownerUserId, not userId — this skips them.
			FilterExpression: "attribute_exists(userId)",
			ExclusiveStartKey: startKey,
		});
		for (const row of page.items) {
			scanned++;
			const userId = row.userId;
			if (userId === undefined) continue;
			const claimKey = gmailIdentityKey(row.email);
			if (claimKey === null) continue;
			const claimPk = gmailClaimPk(claimKey);
			try {
				await users.put({
					Item: { email: claimPk, ownerUserId: userId },
					ConditionExpression: "attribute_not_exists(email)",
				});
				claimed++;
			} catch (error) {
				if (!(error instanceof ConditionalCheckFailedException)) throw error;
				// Claim already exists: idempotent if this row owns it, otherwise a
				// pre-existing duplicate that needs a manual merge (left claimless).
				const existing = await users.get({ email: claimPk }, { projection: ["ownerUserId"] });
				if (existing?.ownerUserId === userId) {
					alreadyOwned++;
				} else {
					collisions++;
					logger.error(
						`Collision: ${row.email} (userId=${userId}) maps to claim ${claimPk} already owned by ${existing?.ownerUserId} — manual merge needed.`,
					);
				}
			}
		}
		startKey = page.lastEvaluatedKey;
	} while (startKey);

	logger.info(
		`Done. Scanned ${scanned} delivery rows; ${claimed} claims written, ${alreadyOwned} already owned (idempotent), ${collisions} collisions need manual review.`,
	);
}

main().catch((err) => {
	logger.error("Backfill failed:", err);
	process.exit(1);
});
/* c8 ignore stop */
