import { type ReadlistSlug, ReadlistSlugSchema } from "@packages/domain/readlist";
import type { FindSmartMatchRevisions, RecordSmartMatchRevision } from "@packages/provider-contracts/article-store";
import { type DynamoDBDocumentClient, defineDynamoTable, writeIfCondition } from "@packages/storage-client";
import { z } from "zod";

const SMART_MATCH_REVISION_PREFIX = "smartMatchRevision#";

export function smartMatchRevisionAttribute(readlist: ReadlistSlug): string {
	return `${SMART_MATCH_REVISION_PREFIX}${readlist}`;
}

const AllRowMarkers = z.looseObject({ savedAt: z.string().optional() });

export function initFindSmartMatchRevisions(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): FindSmartMatchRevisions {
	const allRows = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: AllRowMarkers,
	});
	return async ({ userId, storedKey }) => {
		const row = await allRows.get({ userId, url: storedKey }, { consistentRead: true });
		if (row?.savedAt === undefined) return { kind: "not-in-all" };
		const revisions = new Map<ReadlistSlug, number>();
		for (const [attribute, value] of Object.entries(row)) {
			if (!attribute.startsWith(SMART_MATCH_REVISION_PREFIX)) continue;
			revisions.set(
				ReadlistSlugSchema.parse(attribute.slice(SMART_MATCH_REVISION_PREFIX.length)),
				z.number().parse(value),
			);
		}
		return { kind: "in-all", savedAt: new Date(row.savedAt), revisions };
	};
}

export function initRecordSmartMatchRevision(deps: {
	client: DynamoDBDocumentClient;
	userArticlesTableName: string;
}): RecordSmartMatchRevision {
	const allRows = defineDynamoTable({
		client: deps.client,
		tableName: deps.userArticlesTableName,
		schema: z.object({ userId: z.string(), url: z.string() }),
	});
	return async ({ userId, storedKey, readlist, revision }) => {
		const outcome = await writeIfCondition(() =>
			allRows.update({
				Key: { userId, url: storedKey },
				UpdateExpression: "SET #marker = :revision",
				ConditionExpression: "attribute_exists(savedAt) AND (attribute_not_exists(#marker) OR #marker < :revision)",
				ExpressionAttributeNames: { "#marker": smartMatchRevisionAttribute(readlist) },
				ExpressionAttributeValues: { ":revision": revision },
			}),
		);
		return { recorded: outcome.kind === "written" };
	};
}
