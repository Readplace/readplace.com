import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { MediaImageFile, UploadId } from "@packages/media-contracts";

export type PutBookImage = (input: { uploadId: UploadId; file: MediaImageFile; bytes: Uint8Array; contentType: string }) => Promise<void>;

export function initPutBookImage(deps: { client: { send: (command: PutObjectCommand) => Promise<unknown> }; bucketName: string }): PutBookImage {
	return ({ uploadId, file, bytes, contentType }) =>
		deps.client.send(new PutObjectCommand({ Bucket: deps.bucketName, Key: `images/${uploadId}/${file}`, Body: bytes, ContentType: contentType })).then(() => undefined);
}
