import assert from "node:assert";
import { EmailDeliveryModeSchema, LEGACY_DELIVERY_MODE } from "@packages/domain/inbox";
import {
	DEFAULT_READLIST_SLUG,
	READLIST_MAX_PER_USER,
	ReadlistLimitReachedError,
	ReadlistSlugSchema,
} from "@packages/domain/readlist";
import {
	writeIfCondition,
	type DynamoDBDocumentClient,
	defineDynamoTable,
	forEachQueryPage,
} from "@packages/storage-client";
import type {
	ClearReadlistDefinitionPurpose,
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	ListReadlistDefinitions,
	RenameReadlistDefinition,
	SetReadlistDefinitionEmailDelivery,
	SetReadlistDefinitionPurpose,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";
import { READLIST_DEFINITION_KEY_PREFIX, readlistDefinitionKey } from "./user-readlist-partition";

const ReadlistDefinitionRow = z.object({
	queueSlug: ReadlistSlugSchema,
	queueLabel: z.string(),
	queuePurpose: z.string().optional(),
	queueEmailDelivery: EmailDeliveryModeSchema.optional(),
	starterCampaignId: z.string().optional(),
	createdAt: z.string(),
});

export function initDynamoDbReadlistDefinitions(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
	createReadlistDefinition: CreateReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	listReadlistDefinitions: ListReadlistDefinitions;
	renameReadlistDefinition: RenameReadlistDefinition;
	setReadlistDefinitionEmailDelivery: SetReadlistDefinitionEmailDelivery;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
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
				purpose: row.queuePurpose,
				emailDelivery: row.queueEmailDelivery ?? LEGACY_DELIVERY_MODE,
				...(row.starterCampaignId === undefined
					? {}
					: { starterCampaignId: row.starterCampaignId }),
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
		const outcome = await writeIfCondition(() => readlistDefinitions.put({
			Item: {
				userId: params.userId,
				url: readlistDefinitionKey(params.slug),
				queueSlug: params.slug,
				queueLabel: params.label,
				createdAt: params.createdAt.toISOString(),
			},
			ConditionExpression: "attribute_not_exists(#url)",
			ExpressionAttributeNames: { "#url": "url" },
		}));
		if (outcome.kind === "condition-failed") {
			return { created: false, ownedCount: owned.length };
		}
		return { created: true, ownedCount: owned.length + 1 };
	};

	const renameReadlistDefinition: RenameReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "SET #label = :label",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#label": "queueLabel" },
			ExpressionAttributeValues: { ":label": params.label },
		}));
		if (outcome.kind === "condition-failed") return { renamed: false };
		return { renamed: true };
	};

	const setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "SET #purpose = :purpose",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#purpose": "queuePurpose" },
			ExpressionAttributeValues: { ":purpose": params.purpose },
		}));
		if (outcome.kind === "condition-failed") return { updated: false };
		return { updated: true };
	};

	const setReadlistDefinitionEmailDelivery: SetReadlistDefinitionEmailDelivery = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "SET #emailDelivery = :emailDelivery",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#emailDelivery": "queueEmailDelivery" },
			ExpressionAttributeValues: { ":emailDelivery": params.emailDelivery },
		}));
		if (outcome.kind === "condition-failed") return { updated: false };
		return { updated: true };
	};

	const clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "REMOVE #purpose",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#purpose": "queuePurpose" },
		}));
		if (outcome.kind === "condition-failed") return { cleared: false };
		return { cleared: true };
	};

	const deleteReadlistDefinition: DeleteReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.delete({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url" },
		}));
		if (outcome.kind === "condition-failed") return { deleted: false };
		return { deleted: true };
	};

	return {
		clearReadlistDefinitionPurpose,
		createReadlistDefinition,
		deleteReadlistDefinition,
		listReadlistDefinitions,
		renameReadlistDefinition,
		setReadlistDefinitionEmailDelivery,
		setReadlistDefinitionPurpose,
	};
}
