import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

export function initS3WriteEmailContent(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): (input: { key: string; html: string }) => Promise<void> {
	return async ({ key, html }) => {
		await deps.client.send(
			new PutObjectCommand({
				Bucket: deps.bucketName,
				Key: key,
				Body: html,
				ContentType: "text/html; charset=utf-8",
			}),
		);
	};
}
