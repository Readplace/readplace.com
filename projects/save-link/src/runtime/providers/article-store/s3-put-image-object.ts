/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

export type PutImageObject = (params: {
	key: string;
	body: Buffer;
	contentType: string;
}) => Promise<void>;

export function initS3PutImageObject(deps: {
	client: S3Client;
	bucketName: string;
}): { putImageObject: PutImageObject } {
	const { client, bucketName } = deps;

	const putImageObject: PutImageObject = async (params) => {
		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: params.key,
				Body: params.body,
				ContentType: params.contentType,
			}),
		);
	};

	return { putImageObject };
}
/* c8 ignore stop */
