import { DeleteObjectsCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

/**
 * Delete every object under each prefix. Rehosted email images have no
 * per-object pointer on the row — only the recomputable per-email prefix — so
 * deletion lists the prefix and removes what it finds. Idempotent: an empty or
 * already-deleted prefix lists nothing and issues no delete.
 */
export function initS3DeleteObjectsByPrefix(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): (prefixes: string[]) => Promise<void> {
	return async (prefixes) => {
		for (const prefix of prefixes) {
			let continuationToken: string | undefined;
			do {
				const listed = await deps.client.send(
					new ListObjectsV2Command({
						Bucket: deps.bucketName,
						// The trailing slash pins the boundary: prefix "content/email-images/ab"
						// must never sweep up a sibling hash that merely starts with "ab".
						Prefix: `${prefix}/`,
						ContinuationToken: continuationToken,
					}),
				);
				const keys = (listed.Contents ?? []).flatMap((object) =>
					object.Key === undefined ? [] : [object.Key],
				);
				if (keys.length > 0) {
					await deps.client.send(
						new DeleteObjectsCommand({
							Bucket: deps.bucketName,
							Delete: { Objects: keys.map((Key) => ({ Key })) },
						}),
					);
				}
				continuationToken = listed.NextContinuationToken;
			} while (continuationToken !== undefined);
		}
	};
}
