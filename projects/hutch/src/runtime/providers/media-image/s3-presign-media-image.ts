import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignMediaImage } from "@packages/domain";
import { bookImagesKeyPrefix } from "@packages/media-contracts";

const MEDIA_IMAGE_URL_TTL_SECONDS = 3600;
const SVG_FILE = /\.svg$/i;

export function initS3PresignMediaImage(deps: { client: S3Client; bucketName: string }): {
	presignMediaImage: PresignMediaImage;
} {
	return {
		presignMediaImage: ({ uploadId, file }) =>
			getSignedUrl(
				deps.client,
				new GetObjectCommand({
					Bucket: deps.bucketName,
					Key: bookImagesKeyPrefix(uploadId) + file,
					...(SVG_FILE.test(file) ? { ResponseContentDisposition: "attachment" } : {}),
				}),
				{ expiresIn: MEDIA_IMAGE_URL_TTL_SECONDS },
			),
	};
}
