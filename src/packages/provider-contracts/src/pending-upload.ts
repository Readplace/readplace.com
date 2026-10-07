import type { SaveAttemptId } from "@packages/domain/article";

export type CreateUploadSlot = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	mediaType: string;
	byteLength: number;
}) => Promise<{ uploadUrl: string; expiresAt: Date }>;

export type StatPendingUpload = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	mediaType: string;
}) => Promise<{ byteLength: number; lastModified: Date } | undefined>;

export type ReadPendingUploadPrefix = (params: {
	url: string;
	saveAttemptId: SaveAttemptId;
	mediaType: string;
	bytes: number;
}) => Promise<Buffer>;
