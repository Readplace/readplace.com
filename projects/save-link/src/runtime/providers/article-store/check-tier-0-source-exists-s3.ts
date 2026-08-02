/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { HeadObjectCommand, NotFound } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { CheckTier0SourceExists } from "../../domain/crawl-article-state/read-tier-snapshot";
import { describeS3Error } from "./describe-s3-error";

export function initCheckTier0SourceExistsS3(deps: {
	client: S3Client;
	bucketName: string;
}): { checkTier0SourceExists: CheckTier0SourceExists } {
	const { client, bucketName } = deps;

	const checkTier0SourceExists: CheckTier0SourceExists = async ({ url }) => {
		const key = ArticleResourceUniqueId.parse(url).toS3SourceKey({ tier: "tier-0" });
		try {
			await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
			return true;
		} catch (err) {
			if (err instanceof NotFound) return false;
			throw new Error(
				`HeadObject failed for s3://${bucketName}/${key} (key ${Buffer.byteLength(key)} bytes): ${describeS3Error(err)}`,
				{ cause: err },
			);
		}
	};

	return { checkTier0SourceExists };
}
/* c8 ignore stop */
