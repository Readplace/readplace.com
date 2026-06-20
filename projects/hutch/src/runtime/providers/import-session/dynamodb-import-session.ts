/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema, type UserId } from "@packages/domain/user";
import {
	IMPORT_SESSION_TTL_SECONDS,
	type ImportSessionStore,
	ImportSessionIdSchema,
} from "@packages/domain/import-session";
import { computeDeselected, toImportSession } from "./import-session-mapping";
import { isAccessibleBy, ownershipCondition } from "./import-session-ownership";

const SessionRow = z.object({
	sessionId: ImportSessionIdSchema,
	userId: dynamoField(UserIdSchema),
	createdAt: z.string(),
	expiresAt: z.number(),
	totalUrls: z.number().int().min(0),
	totalFoundInFile: z.number().int().min(0),
	truncated: z.boolean(),
	urls: z.array(z.string()),
	deselected: dynamoField(z.array(z.number().int())),
	allSelected: dynamoField(z.boolean()),
});

export function initDynamoDbImportSession(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
	now: () => Date;
}): ImportSessionStore {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: SessionRow,
	});

	async function loadAccessible(id: string, userId: UserId | undefined) {
		const row = await table.get({ sessionId: id });
		if (!row) return undefined;
		if (row.expiresAt < Math.floor(deps.now().getTime() / 1000)) return undefined;
		return isAccessibleBy({ ownerId: row.userId, callerId: userId }) ? row : undefined;
	}

	return {
		createImportSession: async ({ userId, urls, truncated, totalFound }) => {
			const id = ImportSessionIdSchema.parse(randomBytes(16).toString("hex"));
			const createdAt = deps.now().toISOString();
			const expiresAt = Math.floor(deps.now().getTime() / 1000) + IMPORT_SESSION_TTL_SECONDS;
			await table.put({
				Item: {
					sessionId: id,
					...(userId ? { userId } : {}),
					createdAt,
					expiresAt,
					totalUrls: urls.length,
					totalFoundInFile: totalFound,
					truncated,
					urls: [...urls],
					deselected: [],
					allSelected: true,
				},
			});
			return {
				id,
				userId,
				createdAt,
				expiresAt,
				totalUrls: urls.length,
				totalFound,
				truncated,
				deselected: new Set<number>(),
			};
		},
		findImportSession: async ({ id, userId }) => {
			const row = await loadAccessible(id, userId);
			return row ? toImportSession(row) : undefined;
		},
		loadImportSessionPage: async ({ id, userId, page, pageSize }) => {
			const row = await loadAccessible(id, userId);
			if (!row) return undefined;
			const start = (page - 1) * pageSize;
			const pageUrls = row.urls.slice(start, start + pageSize);
			return { session: toImportSession(row), pageUrls, page, pageSize };
		},
		loadAllImportSessionUrls: async ({ id, userId }) => {
			const row = await loadAccessible(id, userId);
			return row?.urls;
		},
		toggleImportSelection: async ({ id, userId, index, checked }) => {
			const row = await loadAccessible(id, userId);
			if (!row) return;
			const allSelected = row.allSelected ?? true;
			if (!allSelected && !checked) return;
			const current = computeDeselected({
				allSelected: row.allSelected,
				deselected: row.deselected,
				totalUrls: row.totalUrls,
			});
			if (checked) current.delete(index);
			else current.add(index);
			await table.update({
				Key: { sessionId: id },
				ConditionExpression: ownershipCondition(userId),
				UpdateExpression: "SET deselected = :d, allSelected = :a",
				ExpressionAttributeValues: {
					...(userId ? { ":uid": userId } : {}),
					":d": Array.from(current),
					":a": true,
				},
			});
		},
		toggleAllImportSelection: async ({ id, userId, checked }) => {
			const row = await loadAccessible(id, userId);
			if (!row) return;
			await table.update({
				Key: { sessionId: id },
				ConditionExpression: ownershipCondition(userId),
				UpdateExpression: "SET deselected = :d, allSelected = :a",
				ExpressionAttributeValues: {
					...(userId ? { ":uid": userId } : {}),
					":d": [],
					":a": checked,
				},
			});
		},
		deleteImportSession: async ({ id, userId }) => {
			await table.delete({
				Key: { sessionId: id },
				ConditionExpression: ownershipCondition(userId),
				...(userId ? { ExpressionAttributeValues: { ":uid": userId } } : {}),
			});
		},
	};
}
/* c8 ignore stop */
