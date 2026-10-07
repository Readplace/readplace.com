import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { CandidateId } from "@packages/domain/article";
import { defineDynamoTable, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import { z } from "zod";

export type RevokeContentCandidates = (params: { url: string; candidateIds: readonly CandidateId[] }) => Promise<void>;

export function initRevokeContentCandidates(deps: { client: Pick<DynamoDBDocumentClient, "send">; tableName: string }): RevokeContentCandidates {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: z.object({}) });
	return async ({ url, candidateIds }) => {
		if (candidateIds.length === 0) return;
		await table.update({
			Key: { url: ArticleResourceUniqueId.parse(url).value },
			UpdateExpression: "ADD contentSelectionRevision :one, revokedCandidateIds :ids",
			ConditionExpression: "attribute_exists(routeId)",
			ExpressionAttributeValues: { ":one": 1, ":ids": new Set(candidateIds) },
		});
	};
}
