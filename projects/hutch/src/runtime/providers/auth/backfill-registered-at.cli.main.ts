/* c8 ignore start -- one-off backfill script, run manually against staging then prod */
import {
	ConditionalCheckFailedException,
	createDynamoDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { requireEnv } from "../../domain/require-env";

const BackfillRow = z.object({
	email: z.string(),
	registeredAt: dynamoField(z.string()),
});

async function main(): Promise<void> {
	const tableName = requireEnv("DYNAMODB_USERS_TABLE");
	const client = createDynamoDocumentClient();
	const users = defineDynamoTable({ client, tableName, schema: BackfillRow });
	const now = new Date().toISOString();

	console.log(`Backfilling registeredAt = ${now} on table ${tableName}`);

	const { items } = await users.scan({
		ProjectionExpression: "email, registeredAt",
	});

	let updatedTotal = 0;
	let alreadySetTotal = 0;

	for (const item of items) {
		if (item.registeredAt) {
			alreadySetTotal++;
			continue;
		}
		try {
			await users.update({
				Key: { email: item.email },
				UpdateExpression: "SET registeredAt = :now",
				ConditionExpression: "attribute_not_exists(registeredAt)",
				ExpressionAttributeValues: { ":now": now },
			});
			updatedTotal++;
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) {
				alreadySetTotal++;
			} else {
				throw error;
			}
		}
	}

	console.log(
		`Done. Scanned ${items.length} rows, set registeredAt on ${updatedTotal}, ${alreadySetTotal} already had a value.`,
	);
}

main().catch((err) => {
	console.error("Backfill failed:", err);
	process.exit(1);
});
/* c8 ignore stop */
