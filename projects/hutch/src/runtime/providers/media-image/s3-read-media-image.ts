import { type S3GetImageObject, readImageObject } from "@packages/article-store";
import { PrivateItemUrlSchema, uploadIdOfPrivateItemUrl } from "@packages/media-contracts";
import type { ReadArticleImage } from "@packages/provider-contracts/article-store";

export function initS3ReadMediaImage(deps: { send: S3GetImageObject; bucketName: string }): ReadArticleImage {
	const { send, bucketName } = deps;

	return ({ url, filename }) =>
		readImageObject({ send, bucketName, key: `images/${uploadIdOfPrivateItemUrl(PrivateItemUrlSchema.parse(url))}/${filename}` });
}
