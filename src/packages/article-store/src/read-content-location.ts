import { z } from "zod";
import { defineDynamoTable, dynamoField, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import type { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { VerificationFields, isUnverifiedWrapperContent } from "./verified-content";

const ContentLocationRow = z.object({
	...VerificationFields,
	contentLocation: dynamoField(z.string().regex(/^s3:\/\/[^/]+\/.+/)),
	purgedAt: dynamoField(z.string()),
});

export type ReadContentLocation = (id: ArticleResourceUniqueId) => Promise<{ bucket: string; key: string } | undefined>;

export function initReadContentLocation(deps: { client: Pick<DynamoDBDocumentClient, "send">; tableName: string; bucketName: string }): ReadContentLocation {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ContentLocationRow });
	return async (id) => {
		const row = await table.get({ url: id.value }, { consistentRead: true });
		if (row === undefined || row.purgedAt !== undefined || isUnverifiedWrapperContent(row)) return undefined;
		if (row.contentLocation === undefined) return { bucket: deps.bucketName, key: id.toS3ContentKey() };
		const object = new URL(row.contentLocation);
		return { bucket: object.hostname, key: object.pathname.slice(1) };
	};
}
