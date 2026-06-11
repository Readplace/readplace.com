import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import assert from "node:assert";
import type { ContentProvider } from "@packages/provider-contracts/article-store";

// Narrow to just the GetObject response shape we actually consume — broader than
// GetObjectCommandOutput, so S3Client.send is structurally assignable, and tests
// can return a plain object literal without faking the full SDK output type.
export type S3GetObject = (cmd: GetObjectCommand) => Promise<{
	Body?: { transformToString: (encoding: string) => Promise<string> };
}>;

export function initS3ReadContent(deps: {
	send: S3GetObject;
	bucketName: string;
}): ContentProvider {
	const { send, bucketName } = deps;

	return async (articleResourceUniqueId) => {
		const key = articleResourceUniqueId.toS3ContentKey();
		try {
			const result = await send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
			assert(result.Body, "S3 GetObject response must have a Body");
			return await result.Body.transformToString("utf-8");
		} catch (error) {
			// NoSuchKey is the contract's "not found" signal — return undefined so the
			// provider chain (read-article-content.ts) advances silently to the next
			// store. Real failures (throttling, network, IAM) keep throwing and stay
			// visible in CloudWatch.
			if (error instanceof NoSuchKey) return undefined;
			throw error;
		}
	};
}
