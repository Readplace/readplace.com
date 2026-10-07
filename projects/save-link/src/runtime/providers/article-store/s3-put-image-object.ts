import assert from "node:assert";
import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { ArticleResourceUniqueId } from "@packages/article-resource-unique-id";
import type { PutImageObject } from "@packages/finalize-article";

export function initS3PutImageObject(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): { putImageObject: PutImageObject } {
	const { client, bucketName } = deps;
	const putImageObject: PutImageObject = async (params) => {
		assert(params.writeContext, "Image upload requires an observed write context");
		const { authorUserId } = params.writeContext;
		if (authorUserId !== undefined) {
			const id = ArticleResourceUniqueId.parse(params.writeContext.url);
			const ownerKey = `${id.toS3MediaOwnersPrefix()}${params.key.slice(`${id.toS3ImagePrefix()}attempts/`.length)}.metadata.json`;
			await client.send(new PutObjectCommand({ Bucket: bucketName, Key: ownerKey, Body: JSON.stringify({ authorUserId, objectKey: params.key }), ContentType: "application/json; charset=utf-8" }));
		}
		await client.send(new PutObjectCommand({ Bucket: bucketName, Key: params.key, Body: params.body, ContentType: params.contentType }));
	};
	return { putImageObject };
}
