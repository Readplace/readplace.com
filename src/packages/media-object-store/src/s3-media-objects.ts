import { DeleteObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { MediaObjectBytes } from "./media-objects.types";

export function initS3MediaObjects(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): MediaObjectBytes {
	return {
		async deleteObject({ key }) {
			await deps.client.send(new DeleteObjectCommand({ Bucket: deps.bucketName, Key: key }));
		},
	};
}
