import { S3ServiceException } from "@aws-sdk/client-s3";

export function describeS3Error(err: unknown): string {
	if (err instanceof S3ServiceException) {
		const status = err.$metadata.httpStatusCode;
		// HEAD responses have no body, so the SDK can't decode a typed error; status === 403
		// covers both AccessDenied and the "Unknown" fallback for missing-key-without-ListBucket.
		if (status === 403) return "AccessDenied (HTTP 403) — role likely missing s3:GetObject/s3:ListBucket on the bucket";
		if (status === 400)
			return `${err.name} (HTTP 400) — S3 rejected the request itself (a key over the 1024-byte limit is the known cause), not a missing object`;
		return `${err.name} (HTTP ${status ?? "unknown"})`;
	}
	return err instanceof Error ? err.message : String(err);
}
