import { GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import assert from "node:assert";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";

export type S3GetImageObject = (cmd: GetObjectCommand) => Promise<{
	Body?: { transformToByteArray: () => Promise<Uint8Array> };
}>;

export async function readImageObject(params: {
	send: S3GetImageObject;
	bucketName: string;
	key: string;
}): Promise<Uint8Array | undefined> {
	try {
		const result = await params.send(new GetObjectCommand({ Bucket: params.bucketName, Key: params.key }));
		assert(result.Body, "S3 GetObject response must have a Body");
		return await result.Body.transformToByteArray();
	} catch (error) {
		if (error instanceof NoSuchKey) return undefined;
		throw error;
	}
}

export function initS3ReadArticleImage(deps: {
	send: S3GetImageObject;
	bucketName: string;
}): ReadArticleImage {
	const { send, bucketName } = deps;

	return ({ url, filename }) =>
		readImageObject({ send, bucketName, key: ArticleResourceUniqueId.parse(url).toS3ImageKey(filename) });
}
