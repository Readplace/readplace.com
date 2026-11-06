import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignEnclosure } from "@packages/domain";

const ENCLOSURE_URL_TTL_SECONDS = 3600;

export function initS3PresignEnclosure(deps: { client: S3Client; bucketName: string }): {
	presignEnclosure: PresignEnclosure;
} {
	return {
		presignEnclosure: ({ object, mediaType }) =>
			getSignedUrl(
				deps.client,
				new GetObjectCommand({ Bucket: deps.bucketName, Key: object, ResponseContentType: mediaType }),
				{ expiresIn: ENCLOSURE_URL_TTL_SECONDS },
			),
	};
}
