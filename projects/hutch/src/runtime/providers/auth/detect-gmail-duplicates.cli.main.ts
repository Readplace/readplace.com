/* c8 ignore start -- one-off read-only detection script, run manually against staging then prod */
import { HutchLogger, consoleLogger } from "@packages/hutch-logger";
import { createDynamoDocumentClient, defineDynamoTable, dynamoField } from "@packages/hutch-storage-client";
import { z } from "zod";
import { canonicalizeEmail } from "@packages/domain/user";
import { requireEnv } from "../../domain/require-env";

const logger = HutchLogger.from(consoleLogger);

const DeliveryRow = z.object({
	email: z.string(),
	userId: z.string(),
	emailVerified: dynamoField(z.boolean()),
	passwordHash: dynamoField(z.string()),
	registeredAt: dynamoField(z.string()),
});

interface Account {
	email: string;
	userId: string;
	emailVerified: boolean;
	hasPassword: boolean;
	registeredAt: string;
}

async function main(): Promise<void> {
	const tableName = requireEnv("DYNAMODB_USERS_TABLE");
	const client = createDynamoDocumentClient();
	const users = defineDynamoTable({ client, tableName, schema: DeliveryRow });

	const groups = new Map<string, Account[]>();
	let scanned = 0;
	let startKey: Record<string, unknown> | undefined;
	do {
		const page = await users.scan({
			// Claim items carry ownerUserId, not userId — this skips them.
			FilterExpression: "attribute_exists(userId)",
			ExclusiveStartKey: startKey,
		});
		for (const row of page.items) {
			scanned++;
			let key: string;
			try {
				key = canonicalizeEmail(row.email);
			} catch (error) {
				logger.error(`Skipping un-canonicalizable email ${row.email}:`, error);
				continue;
			}
			const account: Account = {
				email: row.email,
				userId: row.userId,
				emailVerified: row.emailVerified === true,
				hasPassword: row.passwordHash !== undefined,
				registeredAt: row.registeredAt ?? "",
			};
			const existing = groups.get(key);
			if (existing) {
				existing.push(account);
			} else {
				groups.set(key, [account]);
			}
		}
		startKey = page.lastEvaluatedKey;
	} while (startKey);

	let duplicateGroups = 0;
	for (const [key, accounts] of groups) {
		if (accounts.length < 2) continue;
		duplicateGroups++;
		// Oldest registration is the natural survivor for a manual merge.
		const sorted = [...accounts].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
		logger.info(`Canonical ${key}: ${accounts.length} accounts (oldest first)`);
		for (const a of sorted) {
			logger.info(
				`  - ${a.email} userId=${a.userId} verified=${a.emailVerified} hasPassword=${a.hasPassword} registeredAt=${a.registeredAt}`,
			);
		}
	}

	logger.info(`Done. Scanned ${scanned} delivery rows; ${duplicateGroups} canonical groups have duplicates.`);
}

main().catch((err) => {
	logger.error("Detection failed:", err);
	process.exit(1);
});
/* c8 ignore stop */
