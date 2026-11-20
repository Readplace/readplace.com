import assert from "node:assert";
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
	PinReadlistDefinition,
	RenameReadlistDefinition,
	SetReadlistDefinitionPurpose,
	UnpinReadlistDefinition,
} from "@packages/provider-contracts/article-store";
import { z } from "zod";
import { READLIST_DEFINITION_KEY_PREFIX, readlistDefinitionKey } from "./user-readlist-partition";

const ReadlistDefinitionRow = z.object({
	queueSlug: ReadlistSlugSchema,
	queueLabel: z.string(),
	queuePurpose: z.string().optional(),
	starterCampaignId: z.string().optional(),
	createdAt: z.string(),
	pinnedAt: z.string().optional(),
});

export function initDynamoDbReadlistDefinitions(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	clearReadlistDefinitionPurpose: ClearReadlistDefinitionPurpose;
	createReadlistDefinition: CreateReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	listReadlistDefinitions: ListReadlistDefinitions;
	pinReadlistDefinition: PinReadlistDefinition;
	renameReadlistDefinition: RenameReadlistDefinition;
	setReadlistDefinitionPurpose: SetReadlistDefinitionPurpose;
	unpinReadlistDefinition: UnpinReadlistDefinition;
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
				...(row.starterCampaignId === undefined
					? {}
					: { starterCampaignId: row.starterCampaignId }),
				createdAt: new Date(row.createdAt),
				...(row.pinnedAt === undefined ? {} : { pinnedAt: new Date(row.pinnedAt) }),
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

	const pinReadlistDefinition: PinReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "SET #pinnedAt = if_not_exists(#pinnedAt, :pinnedAt)",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#pinnedAt": "pinnedAt" },
			ExpressionAttributeValues: { ":pinnedAt": params.pinnedAt.toISOString() },
		}));
		if (outcome.kind === "condition-failed") return { pinned: false };
		return { pinned: true };
	};

	const unpinReadlistDefinition: UnpinReadlistDefinition = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "REMOVE #pinnedAt",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: { "#url": "url", "#pinnedAt": "pinnedAt" },
		}));
		if (outcome.kind === "condition-failed") return { unpinned: false };
		return { unpinned: true };
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
		pinReadlistDefinition,
		renameReadlistDefinition,
		setReadlistDefinitionPurpose,
		unpinReadlistDefinition,
	};
}
