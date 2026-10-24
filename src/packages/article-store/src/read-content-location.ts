import { z } from "zod";
import { defineDynamoTable, type DynamoDBDocumentClient } from "@packages/hutch-storage-client";
import type { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { ServedBodyFields, servedBodyOf } from "./served-body";

const ContentLocationRow = z.object(ServedBodyFields);

export type ReadContentLocation = (id: ArticleResourceUniqueId) => Promise<{ bucket: string; key: string } | undefined>;

export function initReadContentLocation(deps: { client: Pick<DynamoDBDocumentClient, "send">; tableName: string; bucketName: string }): ReadContentLocation {
	const table = defineDynamoTable({ client: deps.client, tableName: deps.tableName, schema: ContentLocationRow });
	return async (id) => {
		const row = await table.get({ url: id.value }, { consistentRead: true });
		if (row === undefined || servedBodyOf(row).kind === "withheld") return undefined;
		if (row.contentLocation === undefined) return { bucket: deps.bucketName, key: id.toS3ContentKey() };
		const object = new URL(row.contentLocation);
		return { bucket: object.hostname, key: object.pathname.slice(1) };
	};
}
