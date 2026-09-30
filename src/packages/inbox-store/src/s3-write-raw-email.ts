import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export function initS3WriteRawEmail(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): (input: { key: string; raw: Buffer }) => Promise<void> {
	return async ({ key, raw }) => {
		await deps.client.send(
			new PutObjectCommand({
				Bucket: deps.bucketName,
				Key: key,
				Body: raw,
				ContentType: "message/rfc822",
			}),
		);
	};
}
