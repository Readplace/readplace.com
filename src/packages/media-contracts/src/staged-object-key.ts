import type { UploadId } from "./upload-id";

export function stagedObjectKey(uploadId: UploadId): string {
	return `pending/${uploadId}/original`;
}
