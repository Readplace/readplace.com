import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { CandidateIdSchema } from "@packages/article-state-types";
import type { ReadCanonicalSnapshot } from "@packages/provider-contracts/canonical-snapshot";
import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField } from "@packages/storage-client";
import { z } from "zod";

const CanonicalSnapshotRow = z.object({
	canonicalContentHash: dynamoField(z.string()),
	canonicalCandidateId: dynamoField(CandidateIdSchema),
});

export function initReadCanonicalSnapshot(deps: {
	client: Pick<DynamoDBDocumentClient, "send">;
	tableName: string;
}): ReadCanonicalSnapshot {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: CanonicalSnapshotRow });
	return async (url) => {
		const row = await table.get(
			{ url: ArticleResourceUniqueId.parse(url).value },
			{ consistentRead: true, projection: ["canonicalContentHash", "canonicalCandidateId"] },
		);
		if (row?.canonicalContentHash === undefined) return undefined;
		return {
			canonicalContentHash: row.canonicalContentHash,
			...(row.canonicalCandidateId === undefined ? {} : { canonicalCandidateId: row.canonicalCandidateId }),
		};
	};
}
