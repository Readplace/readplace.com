import { GetObjectCommand, NoSuchKey, type S3Client } from "@aws-sdk/client-s3";

export function initS3ReadRawEmail(deps: {
	client: Pick<S3Client, "send">;
	bucketName: string;
}): (s3Key: string) => Promise<Buffer | undefined> {
	return async (s3Key) => {
		try {
			const result = await deps.client.send(
				new GetObjectCommand({ Bucket: deps.bucketName, Key: s3Key }),
			);
			// NoSuchKey is the not-found signal; a missing Body is the same.
			if (!result.Body) return undefined;
			return Buffer.from(await result.Body.transformToByteArray());
		} catch (error) {
			if (error instanceof NoSuchKey) return undefined;
			throw error;
		}
	};
}
