import { PutObjectCommand, S3ServiceException, type S3Client } from "@aws-sdk/client-s3";

export function initS3WriteRawEmail(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): (input: { key: string; raw: Buffer }) => Promise<void> {
	return async ({ key, raw }) => {
		try {
			await deps.client.send(new PutObjectCommand({
				Bucket: deps.bucketName,
				Key: key,
				Body: raw,
				ContentType: "message/rfc822",
				IfNoneMatch: "*",
			}));
		} catch (error) {
			if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 412) return;
			throw error;
		}
	};
}
