import type { S3Client } from "@aws-sdk/client-s3";
import { initS3DeleteContentObjects } from "./s3-delete-content-objects";
import { initS3ListContentKeys } from "./s3-list-content-keys";

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
	const { listContentKeys } = initS3ListContentKeys(deps);
	const { deleteContentObjects } = initS3DeleteContentObjects(deps);
	return async (prefixes) => {
		for (const prefix of prefixes) {
			// The trailing slash pins the boundary: prefix "content/email-images/ab"
			// must never sweep up a sibling hash that merely starts with "ab".
			const keys = await listContentKeys(prefix.endsWith("/") ? prefix : `${prefix}/`);
			await deleteContentObjects(keys);
		}
	};
}
