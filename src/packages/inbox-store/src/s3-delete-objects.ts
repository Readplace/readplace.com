import { DeleteObjectsCommand, type S3Client } from "@aws-sdk/client-s3";

/** DeleteObjects accepts at most 1000 keys per request. */
const DELETE_OBJECTS_MAX_KEYS = 1000;

export function initS3DeleteObjects(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): (keys: string[]) => Promise<void> {
	return async (keys) => {
		// An empty key list issues no request — an empty DeleteObjects call is a
		// pointless round-trip and S3 rejects a zero-length Objects list.
		for (let i = 0; i < keys.length; i += DELETE_OBJECTS_MAX_KEYS) {
			const batch = keys.slice(i, i + DELETE_OBJECTS_MAX_KEYS);
			await deps.client.send(
				new DeleteObjectsCommand({
					Bucket: deps.bucketName,
					Delete: { Objects: batch.map((Key) => ({ Key })) },
				}),
			);
		}
	};
}
