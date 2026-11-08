import type { Enclosure, MediaImageFile, MediaKindName, PrivateItemUrl, UploadId } from "@packages/media-contracts";
import type { SaveAttemptId } from "../article";
import type { UserId } from "../user/user.types";

export type MediaUploadSessionState = "staged" | "committed" | "failed";

export interface MediaUploadSession {
	readonly uploadId: UploadId;
	readonly userId: UserId;
	readonly kind?: MediaKindName;
	readonly fileName?: string;
	readonly byteLength?: number;
	readonly saveAttemptId: SaveAttemptId;
	readonly metered?: boolean;
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

export type MediaPendingSuccessAction = { redirect: string } | { status: "201" };

export type MintMediaPendingPost = (params: {
	uploadId: UploadId;
	uploadCeilingBytes: number;
	successAction: MediaPendingSuccessAction;
}) => Promise<{ url: string; fields: Readonly<Record<string, string>> }>;

export type HeadMediaPendingOriginal = (params: {
	uploadId: UploadId;
}) => Promise<{ etag: string; size: number } | undefined>;

export type ReadTimedDuration = (params: {
	uploadId: UploadId;
	etag: string;
}) => Promise<
	{ durationSeconds: number; hasAudio: boolean; hasVideo: boolean } | { unreadable: true } | { atLeastSeconds: number }
>;

export type ReadMediaPendingPrefix = (params: { uploadId: UploadId; etag: string; bytes: number }) => Promise<Uint8Array>;

export type PresignMediaImage = (input: { uploadId: UploadId; file: MediaImageFile }) => Promise<string>;

export type PresignEnclosure = (input: Pick<Enclosure, "object" | "mediaType">) => Promise<string>;

export type PublishMediaUploadCommitted = (params: {
	uploadId: UploadId;
	kind: MediaKindName;
	url: PrivateItemUrl;
	userId: UserId;
	saveAttemptId: SaveAttemptId;
	etag: string;
	attempt: number;
	chargedSeconds?: number;
}) => Promise<void>;
