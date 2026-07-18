import { PutObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function createPresignerClient(config: S3ClientConfig = {}): S3Client {
	return new S3Client({ ...config, requestChecksumCalculation: "WHEN_REQUIRED" });
}

export async function mintUploadUrl(deps: {
	client: S3Client;
	bucket: string;
	key: string;
	contentType: string;
	contentLength: number;
	expiresIn: number;
}): Promise<string> {
	return getSignedUrl(
		deps.client,
		new PutObjectCommand({
			Bucket: deps.bucket,
			Key: deps.key,
			ContentType: deps.contentType,
			ContentLength: deps.contentLength,
		}),
		{ expiresIn: deps.expiresIn },
	);
}
