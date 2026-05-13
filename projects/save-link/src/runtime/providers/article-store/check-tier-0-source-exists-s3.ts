/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { HeadObjectCommand, NotFound, S3ServiceException } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "../../domain/save-link/article-resource-unique-id";
import type { CheckTier0SourceExists } from "../../domain/crawl-article-state/read-tier-snapshot";

function describeS3Error(err: unknown): string {
	if (err instanceof S3ServiceException) {
		const status = err.$metadata.httpStatusCode;
		// HEAD responses have no body, so the SDK can't decode a typed error; status === 403
		// covers both AccessDenied and the "Unknown" fallback for missing-key-without-ListBucket.
		if (status === 403) return "AccessDenied (HTTP 403) — role likely missing s3:GetObject/s3:ListBucket on the bucket";
		return `${err.name} (HTTP ${status ?? "unknown"})`;
	}
	return err instanceof Error ? err.message : String(err);
}

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
			throw new Error(`HeadObject failed for s3://${bucketName}/${key}: ${describeS3Error(err)}`, { cause: err });
		}
	};

	return { checkTier0SourceExists };
}
/* c8 ignore stop */
