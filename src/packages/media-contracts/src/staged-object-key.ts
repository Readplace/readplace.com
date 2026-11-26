import type { UploadId } from "./upload-id";

export function stagedObjectKey(uploadId: UploadId): string {
	return `pending/${uploadId}/original`;
}

export function transcriptsKeyPrefix(uploadId: UploadId): string {
	return `transcripts/${uploadId}/`;
}

export function bookImagesKeyPrefix(uploadId: UploadId): string {
	return `images/${uploadId}/`;
}
