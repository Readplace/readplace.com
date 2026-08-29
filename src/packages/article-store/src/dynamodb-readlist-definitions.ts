import assert from "node:assert";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_MAX_PER_USER,
	ReadlistLimitReachedError,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import type {
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	ListReadlistDefinitions,
	RenameReadlistDefinition,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";
import { READLIST_DEFINITION_KEY_PREFIX, readlistDefinitionKey } from "./user-readlist-partition";

const ReadlistDefinitionRow = z.object({
	queueSlug: ReadlistSlugSchema,
	queueLabel: z.string(),
	createdAt: z.string(),
});

export function initDynamoDbReadlistDefinitions(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	createReadlistDefinition: CreateReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	listReadlistDefinitions: ListReadlistDefinitions;
	renameReadlistDefinition: RenameReadlistDefinition;
} {
	const readlistDefinitions = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: ReadlistDefinitionRow,
	});

	const listReadlistDefinitions: ListReadlistDefinitions = async (userId) => {
		const rows: z.infer<typeof ReadlistDefinitionRow>[] = [];
		await forEachQueryPage(
			readlistDefinitions,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": userId,
					":prefix": READLIST_DEFINITION_KEY_PREFIX,
				},
				ConsistentRead: true,
			},
			async (items) => {
				rows.push(...items);
			},
		);
		return rows
			.map((row) => ({
				slug: row.queueSlug,
				label: row.queueLabel,
				createdAt: new Date(row.createdAt),
			}))
			.sort(
				(a, b) =>
					a.createdAt.getTime() - b.createdAt.getTime() || a.slug.localeCompare(b.slug),
			);
	};

	const createReadlistDefinition: CreateReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const owned = await listReadlistDefinitions(params.userId);
		if (owned.length >= READLIST_MAX_PER_USER) {
			throw new ReadlistLimitReachedError(READLIST_MAX_PER_USER);
		}
		try {
			await readlistDefinitions.put({
				Item: {
					userId: params.userId,
					url: readlistDefinitionKey(params.slug),
					queueSlug: params.slug,
					queueLabel: params.label,
					createdAt: params.createdAt.toISOString(),
				},
				ConditionExpression: "attribute_not_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			});
			return { created: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return { created: false };
			throw error;
		}
	};

	const renameReadlistDefinition: RenameReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		try {
			await readlistDefinitions.update({
				Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
				UpdateExpression: "SET #label = :label",
				ConditionExpression: "attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url", "#label": "queueLabel" },
				ExpressionAttributeValues: { ":label": params.label },
			});
			return { renamed: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return { renamed: false };
			throw error;
		}
	};

	const deleteReadlistDefinition: DeleteReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		try {
			await readlistDefinitions.delete({
				Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
				ConditionExpression: "attribute_exists(#url)",
				ExpressionAttributeNames: { "#url": "url" },
			});
			return { deleted: true };
		} catch (error) {
			if (error instanceof ConditionalCheckFailedException) return { deleted: false };
			throw error;
		}
	};

	return { createReadlistDefinition, deleteReadlistDefinition, listReadlistDefinitions, renameReadlistDefinition };
}
