/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	ConditionalCheckFailedException,
	type DynamoDBDocumentClient,
	defineDynamoTable,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "../save-link/article-resource-unique-id";
import type { IncrementCrawlAutoHealAttempt } from "@packages/test-fixtures/providers/article-crawl";

const Row = z.object({
	url: z.string(),
});

export function initIncrementCrawlAutoHealAttempt(deps: {
	client: DynamoDBDocumentClient;
	tableName: string;
}): { incrementCrawlAutoHealAttempt: IncrementCrawlAutoHealAttempt } {
	const table = defineDynamoTable({
		client: deps.client,
		tableName: deps.tableName,
		schema: Row,
	});

	const incrementCrawlAutoHealAttempt: IncrementCrawlAutoHealAttempt = async ({
		url,
		nowIso,
		maxAttempts,
		ttlMs,
	}) => {
		const articleResourceUniqueId = ArticleResourceUniqueId.parse(url);
		const ttlCutoffIso = new Date(new Date(nowIso).getTime() - ttlMs).toISOString();
		try {
			await table.update({
				Key: { url: articleResourceUniqueId.value },
				// ADD treats a missing attribute as 0 + delta. Both writes happen
				// atomically, so two concurrent reprimes can never both slip
				// through at attempts=maxAttempts-1.
				UpdateExpression:
					"ADD crawlAutoHealAttempts :one SET crawlAutoHealLastAttemptAt = :nowIso",
				// Allow the increment when any of:
				//   - first attempt (counter not yet present)
				//   - attempts strictly under the cap
				//   - last attempt is older than the TTL window (operator/world
				//     state may have changed; let the user try again)
				ConditionExpression:
					"attribute_not_exists(crawlAutoHealAttempts) OR crawlAutoHealAttempts < :maxAttempts OR crawlAutoHealLastAttemptAt < :ttlCutoffIso",
				ExpressionAttributeValues: {
					":one": 1,
					":nowIso": nowIso,
					":maxAttempts": maxAttempts,
					":ttlCutoffIso": ttlCutoffIso,
				},
			});
			return "reprimed";
		} catch (err) {
			if (err instanceof ConditionalCheckFailedException) return "capped";
			throw err;
		}
	};

	return { incrementCrawlAutoHealAttempt };
}
/* c8 ignore stop */
