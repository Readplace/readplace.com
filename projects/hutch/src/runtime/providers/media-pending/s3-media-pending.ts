/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import assert from "node:assert";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { HeadMediaPendingOriginal, MintMediaPendingPost, ReadMediaPendingPrefix } from "@packages/domain";
import type { UploadId } from "@packages/media-contracts";

const POST_POLICY_TTL_SECONDS = 3600;

function pendingOriginalKey(uploadId: UploadId): string {
	return `pending/${uploadId}/original`;
}

export function initS3MediaPending(deps: { presignerClient: S3Client; client: S3Client; bucketName: string }): {
	mintMediaPendingPost: MintMediaPendingPost;
	headMediaPendingOriginal: HeadMediaPendingOriginal;
	readMediaPendingPrefix: ReadMediaPendingPrefix;
} {
	const mintMediaPendingPost: MintMediaPendingPost = async ({
		uploadId,
		contentType,
		uploadCeilingBytes,
		successActionRedirect,
	}) => {
		const { url, fields } = await createPresignedPost(deps.presignerClient, {
			Bucket: deps.bucketName,
			Key: pendingOriginalKey(uploadId),
			Conditions: [
				["content-length-range", 1, uploadCeilingBytes],
				["eq", "$Content-Type", contentType],
				["eq", "$success_action_redirect", successActionRedirect],
			],
			Fields: { "Content-Type": contentType, success_action_redirect: successActionRedirect },
			Expires: POST_POLICY_TTL_SECONDS,
		});
		return { url, fields };
	};

	const headMediaPendingOriginal: HeadMediaPendingOriginal = async ({ uploadId }) => {
		try {
			const head = await deps.client.send(
				new HeadObjectCommand({ Bucket: deps.bucketName, Key: pendingOriginalKey(uploadId) }),
			);
			assert(head.ETag && head.ContentLength !== undefined, "HeadObject missing etag/size");
			return { etag: head.ETag, size: head.ContentLength };
		} catch (error) {
			if (error instanceof Error && error.name === "NotFound") return undefined;
			throw error;
		}
	};

	const readMediaPendingPrefix: ReadMediaPendingPrefix = async ({ uploadId, etag, bytes }) => {
		const result = await deps.client.send(
			new GetObjectCommand({
				Bucket: deps.bucketName,
				Key: pendingOriginalKey(uploadId),
				Range: `bytes=0-${bytes - 1}`,
				IfMatch: etag,
			}),
		);
		assert(result.Body, "GetObject returned no body");
		return result.Body.transformToByteArray();
	};

	return { mintMediaPendingPost, headMediaPendingOriginal, readMediaPendingPrefix };
}
/* c8 ignore stop */
