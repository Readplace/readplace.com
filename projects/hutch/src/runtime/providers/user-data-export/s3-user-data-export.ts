/* c8 ignore start -- thin AWS SDK wrapper, tested via integration */
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	EXPORT_DOWNLOAD_TTL_SECONDS,
	EXPORT_S3_KEY_PREFIX,
} from "../../web/pages/export/export-ttl";
import type { DeleteUserExports, UploadUserDataExport } from "./user-data-export.types";

export function initS3UserDataExport(deps: {
	client: S3Client;
	bucketName: string;
	now: () => Date;
}): { uploadUserDataExport: UploadUserDataExport; deleteUserExports: DeleteUserExports } {
	const { client, bucketName, now } = deps;

	const uploadUserDataExport: UploadUserDataExport = async ({ userId, body }) => {
		const timestamp = now().toISOString().replace(/[:.]/g, "-");
		const s3Key = `${EXPORT_S3_KEY_PREFIX}${userId}/${timestamp}.json`;
		const filename = `readplace-export-${timestamp.slice(0, 10)}.json`;

		await client.send(
			new PutObjectCommand({
				Bucket: bucketName,
				Key: s3Key,
				Body: body,
				ContentType: "application/json",
				ContentDisposition: `attachment; filename="${filename}"`,
			}),
		);

		const downloadUrl = await getSignedUrl(
			client,
			new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
			{ expiresIn: EXPORT_DOWNLOAD_TTL_SECONDS },
		);

		return { s3Key, downloadUrl };
	};

	const deleteUserExports: DeleteUserExports = async (userId) => {
		const Prefix = `${EXPORT_S3_KEY_PREFIX}${userId}/`;
		let ContinuationToken: string | undefined;
		do {
			const list = await client.send(
				new ListObjectsV2Command({ Bucket: bucketName, Prefix, ContinuationToken }),
			);
			const objects = (list.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
			if (objects.length > 0) {
				await client.send(
					new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: objects } }),
				);
			}
			ContinuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
		} while (ContinuationToken);
	};

	return { uploadUserDataExport, deleteUserExports };
}
/* c8 ignore stop */
