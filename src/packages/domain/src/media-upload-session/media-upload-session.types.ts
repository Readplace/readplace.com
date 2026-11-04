import type { MediaKindName, UploadId } from "@packages/media-contracts";
import type { SaveAttemptId } from "../article";
import type { UserId } from "../user/user.types";

export type MediaUploadSessionState = "staged" | "committed" | "failed";

export interface MediaUploadSession {
	readonly uploadId: UploadId;
	readonly userId: UserId;
	readonly kind: MediaKindName;
	readonly fileName: string;
	readonly byteLength?: number;
	readonly saveAttemptId: SaveAttemptId;
	readonly status: MediaUploadSessionState;
}

export type CreateMediaUploadSession = (params: Omit<MediaUploadSession, "status">) => Promise<MediaUploadSession>;

export type FindMediaUploadSession = (params: {
	uploadId: UploadId;
	userId: UserId;
}) => Promise<MediaUploadSession | undefined>;

export type MarkMediaUploadCommitted = (params: {
	uploadId: UploadId;
	userId: UserId;
}) => Promise<"committed" | "not-staged">;

export type FailMediaUpload = (params: { uploadId: UploadId }) => Promise<"failed" | "not-committed">;
