/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	type DynamoDBDocumentClient,
	defineDynamoTable,
	dynamoField,
} from "@packages/hutch-storage-client";
import { z } from "zod";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import { type Tier, TierSchema } from "../../domain/select-content/tier.types";

const TierRow = z.object({
	contentSourceTier: dynamoField(z.string()),
});

export type FindContentSourceTier = (url: string) => Promise<Tier | undefined>;

export function initFindContentSourceTier(deps: {
	dynamoClient: DynamoDBDocumentClient;
	tableName: string;
}): { findContentSourceTier: FindContentSourceTier } {
	const { dynamoClient, tableName } = deps;

	const articleTable = defineDynamoTable({
		client: dynamoClient,
		tableName,
		schema: TierRow,
	});

	const findContentSourceTier: FindContentSourceTier = async (url) => {
		const id = ArticleResourceUniqueId.parse(url);
		const row = await articleTable.get(
			{ url: id.value },
			{ projection: ["contentSourceTier"] },
		);
		const value = row?.contentSourceTier;
		if (value === undefined) return undefined;
		const parsed = TierSchema.safeParse(value);
		return parsed.success ? parsed.data : undefined;
	};

	return { findContentSourceTier };
}
/* c8 ignore stop */
