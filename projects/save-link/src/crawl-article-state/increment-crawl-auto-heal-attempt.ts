/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";
import type {
	FindAutoHealState,
	WriteAutoHealAttempt,
} from "@packages/test-fixtures/providers/article-crawl";

const Row = z.object({
	url: z.string(),
	crawlAutoHealAttempts: dynamoField(z.number()),
	crawlAutoHealLastAttemptAt: dynamoField(z.string()),
});

export function initAutoHealStore(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): {
	findAutoHealState: FindAutoHealState;
	writeAutoHealAttempt: WriteAutoHealAttempt;
} {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: Row,
	});

	const findAutoHealState: FindAutoHealState = async (url) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const row = await table.get({ url: articleResourceUniqueId.value });
		if (
			row?.crawlAutoHealAttempts === undefined ||
			row?.crawlAutoHealLastAttemptAt === undefined
		) {
			return undefined;
		}
		return {
			attempts: row.crawlAutoHealAttempts,
			lastAttemptAtIso: row.crawlAutoHealLastAttemptAt,
		};
	};

	const writeAutoHealAttempt: WriteAutoHealAttempt = async ({
		url,
		attempts,
		lastAttemptAtIso,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		await table.update({
			Key: { url: articleResourceUniqueId.value },
			UpdateExpression:
				"SET crawlAutoHealAttempts = :attempts, crawlAutoHealLastAttemptAt = :lastAt",
			ExpressionAttributeValues: {
				":attempts": attempts,
				":lastAt": lastAttemptAtIso,
			},
		});
	};

	return { findAutoHealState, writeAutoHealAttempt };
}
/* c8 ignore stop */
