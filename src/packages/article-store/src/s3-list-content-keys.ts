import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";

export type ListContentKeys = (prefix: string) => Promise<string[]>;

export function initS3ListContentKeys(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): { listContentKeys: ListContentKeys } {
	const listContentKeys: ListContentKeys = async (prefix) => {
		const keys: string[] = [];
		let continuationToken: string | undefined;
		do {
			const result = await deps.client.send(
				new ListObjectsV2Command({
					Bucket: deps.bucketName,
					Prefix: prefix,
					...(continuationToken === undefined
						? {}
						: { ContinuationToken: continuationToken }),
				}),
			);
			for (const object of result.Contents ?? []) {
				if (object.Key !== undefined) keys.push(object.Key);
			}
			continuationToken = result.NextContinuationToken;
		} while (continuationToken !== undefined);
		return keys;
	};

	return { listContentKeys };
}
