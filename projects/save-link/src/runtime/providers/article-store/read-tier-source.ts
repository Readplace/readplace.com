/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { GetObjectCommand, NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import type { HutchLogger } from "@packages/hutch-logger";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { Tier } from "../../domain/select-content/tier.types";
import { type TierSource, TierSourceMetadataSchema } from "../../domain/select-content/tier-source.types";

export type ReadTierSource = (params: {
	url: string;
	tier: Tier;
}) => Promise<TierSource | undefined>;

export function initReadTierSource(deps: {
	client: S3Client;
	bucketName: string;
	logger: HutchLogger;
}): { readTierSource: ReadTierSource } {
	const { client, bucketName, logger } = deps;

	const readTierSource: ReadTierSource = async (params) => {
		const id = ArticleResourceUniqueId.parse(params.url);
		const htmlKey = id.toS3SourceKey({ tier: params.tier });
		const metadataKey = id.toS3SourceMetadataKey({ tier: params.tier });

		const html = await tryGetObject(client, bucketName, htmlKey);
		if (html === undefined) return undefined;

		const metadataRaw = await tryGetObject(client, bucketName, metadataKey);
		if (metadataRaw === undefined) {
			// HTML written but sidecar absent — treat as not-yet-fully-written.
			// SQS retry on the worker (or a new save) will eventually backfill.
			logger.info("[ReadTierSource] missing metadata sidecar", {
				url: params.url,
				tier: params.tier,
			});
			return undefined;
		}

		const parsed = TierSourceMetadataSchema.safeParse(JSON.parse(metadataRaw));
		if (!parsed.success) {
			logger.info("[ReadTierSource] malformed metadata sidecar", {
				url: params.url,
				tier: params.tier,
			});
			return undefined;
		}

		return { tier: params.tier, html, metadata: parsed.data };
	};

	return { readTierSource };
}

async function tryGetObject(
	client: S3Client,
	bucketName: string,
	key: string,
): Promise<string | undefined> {
	try {
		const response = await client.send(
			new GetObjectCommand({ Bucket: bucketName, Key: key }),
		);
		if (!response.Body) return undefined;
		return await response.Body.transformToString("utf-8");
	} catch (error) {
		if (error instanceof NoSuchKey) return undefined;
		if (error instanceof S3ServiceException && error.name === "NoSuchKey") return undefined;
		throw error;
	}
}
/* c8 ignore stop */
