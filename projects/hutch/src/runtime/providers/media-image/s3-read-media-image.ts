import assert from "node:assert";
import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import type { S3GetImageObject } from "@packages/article-store";
import { PrivateItemUrlSchema, uploadIdOfPrivateItemUrl } from "@packages/media-contracts";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";

export function initS3ReadMediaImage(deps: { send: S3GetImageObject; bucketName: string }): ReadArticleImage {
	const { send, bucketName } = deps;

	return async ({ url, filename }) => {
		const key = `images/${uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url))}/${filename}`;
		try {
			const result = await send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
			assert(result.Body, "S3 GetObject response must have a Body");
			return await result.Body.transformToByteArray();
		} catch (error) {
			if (error instanceof NoSuchKey) return undefined;
			throw error;
		}
	};
}
