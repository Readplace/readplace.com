/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";

const CanonicalContentHashRow = z.object({
	canonicalContentHash: dynamoField(z.string()),
});

export type FindCanonicalContentHash = (url: string) => Promise<string | undefined>;

export function initFindCanonicalContentHash(deps: {
	dynamoClient: DynamoDBDocumentClient;
	tableName: string;
}): { findCanonicalContentHash: FindCanonicalContentHash } {
	const { dynamoClient, tableName } = deps;

	const articleTable = defineDynamoTable({
		client: dynamoClient,
		tableName,
		schema: CanonicalContentHashRow,
	});

	const findCanonicalContentHash: FindCanonicalContentHash = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		const row = await articleTable.get(
			{ url: id.value },
			{ projection: ["canonicalContentHash"] },
		);
		return row?.canonicalContentHash;
	};

	return { findCanonicalContentHash };
}
/* c8 ignore stop */
