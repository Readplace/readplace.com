/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { randomBytes } from "node:crypto";
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { UserIdSchema } from "@packages/domain/user";
import {
	IMPORT_SESSION_TTL_SECONDS,
	ImportSessionIdSchema,
} from "@packages/domain/import-session";
import type {
	ImportSession,
	ImportSessionStore,
} from "@packages/domain/import-session";

const SessionRow = z.object({
	sessionId: ImportSessionIdSchema,
	userId: UserIdSchema,
	createdAt: z.string(),
	expiresAt: z.number(),
	totalUrls: z.number().int().min(0),
	totalFoundInFile: z.number().int().min(0),
	truncated: z.boolean(),
	urls: z.array(z.string()),
	deselected: dynamoField(z.array(z.number().int())),
	allSelected: dynamoField(z.boolean()),
});

function toSession(row: z.infer<typeof SessionRow>): ImportSession {
	const allSelected = row.allSelected ?? true;
	return {
		id: row.sessionId,
		userId: row.userId,
		createdAt: row.createdAt,
		expiresAt: row.expiresAt,
		totalUrls: row.totalUrls,
		totalFound: row.totalFoundInFile,
		truncated: row.truncated,
		deselected: allSelected
			? new Set(row.deselected ?? [])
			: new Set(Array.from({ length: row.totalUrls }, (_v, i) => i)),
	};
}

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

	async function loadOwned(id: string, userId: string) {
		const row = await table.get({ sessionId: id });
		if (!row) return undefined;
		if (row.userId !== userId) return undefined;
		if (row.expiresAt < Math.floor(deps.now().getTime() / 1000)) return undefined;
		return row;
	}

	return {
		createImportSession: async ({ userId, urls, truncated, totalFound }) => {
			const id = ImportSessionIdSchema.parse(randomBytes(16).toString("hex"));
			const createdAt = deps.now().toISOString();
			const expiresAt = Math.floor(deps.now().getTime() / 1000) + IMPORT_SESSION_TTL_SECONDS;
			await table.put({
				Item: {
					sessionId: id,
					userId,
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
			const row = await loadOwned(id, userId);
			return row ? toSession(row) : undefined;
		},
		loadImportSessionPage: async ({ id, userId, page, pageSize }) => {
			const row = await loadOwned(id, userId);
			if (!row) return undefined;
			const start = (page - 1) * pageSize;
			const pageUrls = row.urls.slice(start, start + pageSize);
			return { session: toSession(row), pageUrls, page, pageSize };
		},
		loadAllImportSessionUrls: async ({ id, userId }) => {
			const row = await loadOwned(id, userId);
			return row?.urls;
		},
		toggleImportSelection: async ({ id, userId, index, checked }) => {
			const row = await loadOwned(id, userId);
			if (!row) return;
			const allSelected = row.allSelected ?? true;
			if (!allSelected && !checked) return;
			const current = allSelected
				? new Set<number>(row.deselected ?? [])
				: new Set(Array.from({ length: row.totalUrls }, (_v, i) => i));
			if (checked) current.delete(index);
			else current.add(index);
			await table.update({
				Key: { sessionId: id },
				ConditionExpression: "userId = :uid",
				UpdateExpression: "SET deselected = :d, allSelected = :a",
				ExpressionAttributeValues: {
					":uid": userId,
					":d": Array.from(current),
					":a": true,
				},
			});
		},
		toggleAllImportSelection: async ({ id, userId, checked }) => {
			const row = await loadOwned(id, userId);
			if (!row) return;
			await table.update({
				Key: { sessionId: id },
				ConditionExpression: "userId = :uid",
				UpdateExpression: "SET deselected = :d, allSelected = :a",
				ExpressionAttributeValues: {
					":uid": userId,
					":d": [],
					":a": checked,
				},
			});
		},
		deleteImportSession: async ({ id, userId }) => {
			await table.delete({
				Key: { sessionId: id },
				ConditionExpression: "userId = :uid",
				ExpressionAttributeValues: { ":uid": userId },
			});
		},
	};
}
/* c8 ignore stop */
