import assert from "node:assert";
import {
	DEFAULT_QUEUE_SLUG,
	QUEUE_MAX_PER_USER,
	QueueLimitReachedError,
	QueueSlugSchema,
} from "@packages/domain/queue";
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/hutch-storage-client";
import type {
	CreateQueueDefinition,
	ListQueueDefinitions,
	RenameQueueDefinition,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";
import { QUEUE_DEFINITION_KEY_PREFIX, queueDefinitionKey } from "./user-queue-partition";

const QueueDefinitionRow = z.object({
	queueSlug: QueueSlugSchema,
	queueLabel: z.string(),
	createdAt: z.string(),
});

export function initDynamoDbQueueDefinitions(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	createQueueDefinition: CreateQueueDefinition;
	listQueueDefinitions: ListQueueDefinitions;
	renameQueueDefinition: RenameQueueDefinition;
} {
	const queueDefinitions = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: QueueDefinitionRow,
	});

	const listQueueDefinitions: ListQueueDefinitions = async (userId) => {
		const rows: z.infer<typeof QueueDefinitionRow>[] = [];
		await forEachQueryPage(
			queueDefinitions,
			{
				KeyConditionExpression: "userId = :userId AND begins_with(#url, :prefix)",
				ExpressionAttributeNames: { "#url": "url" },
				ExpressionAttributeValues: {
					":userId": userId,
					":prefix": QUEUE_DEFINITION_KEY_PREFIX,
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

	const createQueueDefinition: CreateQueueDefinition = async (params) => {
		assert(params.slug !== DEFAULT_QUEUE_SLUG, "the default queue is implicit and holds no definition row");
		const owned = await listQueueDefinitions(params.userId);
		if (owned.length >= QUEUE_MAX_PER_USER) {
			throw new QueueLimitReachedError(QUEUE_MAX_PER_USER);
		}
		try {
			await queueDefinitions.put({
				Item: {
					userId: params.userId,
					url: queueDefinitionKey(params.slug),
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

	const renameQueueDefinition: RenameQueueDefinition = async (params) => {
		assert(params.slug !== DEFAULT_QUEUE_SLUG, "the default queue is implicit and holds no definition row");
		try {
			await queueDefinitions.update({
				Key: { userId: params.userId, url: queueDefinitionKey(params.slug) },
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

	return { createQueueDefinition, listQueueDefinitions, renameQueueDefinition };
}
