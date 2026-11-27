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
	CreateReadlistDefinition,
	DeleteReadlistDefinition,
	ListReadlistDefinitions,
	PinReadlistDefinition,
	ReadlistFiling,
	RenameReadlistDefinition,
	SetSmartReadlistRule,
	TurnOffSmartReadlistMatching,
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
	filingMode: z.enum(["manual", "smart"]).optional(),
	filingRuleRevision: z.number().optional(),
	filingRuleEffectiveAt: z.string().optional(),
});

const UpdatedFilingRuleRevision = z.object({ filingRuleRevision: z.number() });

function toFiling(row: z.infer<typeof ReadlistDefinitionRow>): { filing?: ReadlistFiling } {
	if (row.filingMode === undefined) return {};
	if (row.filingMode === "manual") return { filing: { mode: "manual" } };
	assert(row.filingRuleRevision !== undefined, "a smart readlist row carries its rule revision");
	assert(row.filingRuleEffectiveAt !== undefined, "a smart readlist row carries its rule's effective instant");
	assert(row.queuePurpose !== undefined, "a smart readlist row carries its purpose");
	return {
		filing: {
			mode: "smart",
			purpose: row.queuePurpose,
			revision: row.filingRuleRevision,
			effectiveAt: new Date(row.filingRuleEffectiveAt),
		},
	};
}

export function initDynamoDbReadlistDefinitions(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): {
	createReadlistDefinition: CreateReadlistDefinition;
	deleteReadlistDefinition: DeleteReadlistDefinition;
	listReadlistDefinitions: ListReadlistDefinitions;
	pinReadlistDefinition: PinReadlistDefinition;
	renameReadlistDefinition: RenameReadlistDefinition;
	setSmartReadlistRule: SetSmartReadlistRule;
	turnOffSmartReadlistMatching: TurnOffSmartReadlistMatching;
	unpinReadlistDefinition: UnpinReadlistDefinition;
} {
	const readlistDefinitions = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: ReadlistDefinitionRow,
	});
	const filingRuleRevisions = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: UpdatedFilingRuleRevision,
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
				...(row.starterCampaignId === undefined
					? {}
					: { starterCampaignId: row.starterCampaignId }),
				createdAt: new Date(row.createdAt),
				...(row.pinnedAt === undefined ? {} : { pinnedAt: new Date(row.pinnedAt) }),
				...toFiling(row),
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
				filingMode: "manual",
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

	const setSmartReadlistRule: SetSmartReadlistRule = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => filingRuleRevisions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression:
				"SET #mode = :smart, #purpose = :purpose, #revision = if_not_exists(#revision, :zero) + :one, #effectiveAt = :effectiveAt",
			ConditionExpression: "attribute_exists(#url)",
			ExpressionAttributeNames: {
				"#url": "url",
				"#mode": "filingMode",
				"#purpose": "queuePurpose",
				"#revision": "filingRuleRevision",
				"#effectiveAt": "filingRuleEffectiveAt",
			},
			ExpressionAttributeValues: {
				":smart": "smart",
				":purpose": params.purpose,
				":zero": 0,
				":one": 1,
				":effectiveAt": params.effectiveAt.toISOString(),
			},
			ReturnValues: "UPDATED_NEW",
		}));
		if (outcome.kind === "condition-failed") return { kind: "readlist-gone" };
		const attributes = outcome.result.Attributes;
		assert(attributes, "an UPDATED_NEW update returns the attributes it wrote");
		return { kind: "set", revision: attributes.filingRuleRevision };
	};

	const turnOffSmartReadlistMatching: TurnOffSmartReadlistMatching = async (params) => {
		assert(params.slug !== DEFAULT_READLIST_SLUG, "the default readlist is implicit and holds no definition row");
		const outcome = await writeIfCondition(() => readlistDefinitions.update({
			Key: { userId: params.userId, url: readlistDefinitionKey(params.slug) },
			UpdateExpression: "SET #mode = :manual, #revision = #revision + :one REMOVE #effectiveAt, #purpose",
			ConditionExpression: "#mode = :smart",
			ExpressionAttributeNames: {
				"#mode": "filingMode",
				"#revision": "filingRuleRevision",
				"#effectiveAt": "filingRuleEffectiveAt",
				"#purpose": "queuePurpose",
			},
			ExpressionAttributeValues: { ":manual": "manual", ":smart": "smart", ":one": 1 },
		}));
		if (outcome.kind === "condition-failed") return { turnedOff: false };
		return { turnedOff: true };
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
		createReadlistDefinition,
		deleteReadlistDefinition,
		listReadlistDefinitions,
		pinReadlistDefinition,
		renameReadlistDefinition,
		setSmartReadlistRule,
		turnOffSmartReadlistMatching,
		unpinReadlistDefinition,
	};
}
