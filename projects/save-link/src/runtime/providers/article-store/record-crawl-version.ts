import { type DynamoDBDocumentClient, defineDynamoTable, dynamoField, writeIfCondition } from "@packages/storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId, toCrawlVersionMinuteId } from "@packages/article-resource-unique-id";
import { type CrawlVersionEntry, StoredCrawlVersionSchema } from "@packages/article-store";
import { appendCrawlVersion, type RecordCrawlVersion } from "../../domain/select-content/crawl-versions";

export type { RecordCrawlVersion } from "../../domain/select-content/crawl-versions";

const CrawlVersionsRow = z.object({ crawlVersions: dynamoField(z.array(StoredCrawlVersionSchema)) });

export function initRecordCrawlVersion(deps: { dynamoClient: DynamoDBDocumentClient; tableName: string }): { recordCrawlVersion: RecordCrawlVersion } {
	const articleTable = defineDynamoTable({ client: deps.dynamoClient, tableName: deps.tableName, schema: CrawlVersionsRow });
	const recordCrawlVersion: RecordCrawlVersion = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const row = await articleTable.get({ url: id.value }, { projection: ["crawlVersions"], consistentRead: true });
		const existing = row?.crawlVersions ?? [];
		const entry: CrawlVersionEntry = {
			minuteId: toCrawlVersionMinuteId(params.crawledAt),
			candidateId: params.canonicalCommit.candidateId,
			...(params.authorUserId === undefined ? {} : { authorUserId: params.authorUserId }),
		};
		const { changed, next } = appendCrawlVersion(existing, entry);
		if (!changed) return;
		const outcome = await writeIfCondition(() =>
			articleTable.update({
				Key: { url: id.value },
				UpdateExpression: "SET crawlVersions = :next",
				ConditionExpression: "canonicalCandidateId = :candidate AND contentSelectionRevision = :revision AND (attribute_not_exists(crawlVersions) OR crawlVersions = :old)",
				ExpressionAttributeValues: { ":next": next, ":old": existing, ":candidate": params.canonicalCommit.candidateId, ":revision": (params.canonicalCommit.expected?.revision ?? 0) + 1 },
				ReturnValuesOnConditionCheckFailure: "ALL_OLD",
			}),
		);
		if (outcome.kind === "written" || outcome.oldItem?.purgedAt !== undefined) return;
		throw outcome.error;
	};
	return { recordCrawlVersion };
}
